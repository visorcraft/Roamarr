import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { createTrip, loadTripFor } from './shared';
import { users } from '$lib/server/db/schema';

test('owner sees full trip; non-owner without share is blocked', () => {
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
	const t = createTrip(a.id, { name: 'Trip', defaultVisibility: 'public' });
	expect(t.publicToken).toBeTruthy();
	expect(loadTripFor(a.id, t.id).owner).toBe(true);
	expect(() => loadTripFor(b.id, t.id)).toThrow();
});
