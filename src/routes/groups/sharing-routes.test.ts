import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _shareWithUserEmail as shareWithUserEmail, _mintPublicToken as mintPublicToken } from '../trips/[id]/share/+page.server';
import { canView } from '$lib/server/sharing';
import { users, trips } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

test('sharing with a user grants canView; public token is set', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const b = db
		.insert(users)
		.values({ email: 'b@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	shareWithUserEmail(a.id, t.id, 'B@X.c');
	expect(canView(b.id, db.select().from(trips).where(eq(trips.id, t.id)).get()!)).toBe(true);
	const token = mintPublicToken(a.id, t.id);
	expect(db.select().from(trips).where(eq(trips.id, t.id)).get()!.publicToken).toBe(token);
});
