import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	_shareWithUserEmail as shareWithUserEmail,
	_shareWithGroup as shareWithGroup,
	_mintPublicToken as mintPublicToken
} from '../trips/[id]/share/+page.server';
import { canView } from '$lib/server/sharing';
import { users, trips, groups, groupMembers } from '$lib/server/db/schema';
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

test('group share requires the group to belong to the sharer', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db
		.insert(users)
		.values({ email: 'o@x.c', passwordHash: 'x', displayName: 'O' })
		.returning()
		.get();
	const other = db
		.insert(users)
		.values({ email: 'g@x.c', passwordHash: 'x', displayName: 'G' })
		.returning()
		.get();
	const member = db
		.insert(users)
		.values({ email: 'm@x.c', passwordHash: 'x', displayName: 'M' })
		.returning()
		.get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();
	const foreign = db.insert(groups).values({ ownerId: other.id, name: 'theirs' }).returning().get();
	expect(() => shareWithGroup(owner.id, t.id, foreign.id)).toThrow();

	const mine = db.insert(groups).values({ ownerId: owner.id, name: 'mine' }).returning().get();
	db.insert(groupMembers).values({ groupId: mine.id, userId: member.id }).run();
	shareWithGroup(owner.id, t.id, mine.id);
	expect(canView(member.id, db.select().from(trips).where(eq(trips.id, t.id)).get()!)).toBe(true);
});
