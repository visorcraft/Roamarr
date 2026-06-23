import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { canView, canEdit, viewerProjection } from './sharing';
import { users, trips, groups, groupMembers, tripShares } from './db/schema';

test('view matrix + projection omits sensitive fields', () => {
	const db = (ctx as { db: import('./db').DB }).db;
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
	const c = db
		.insert(users)
		.values({ email: 'c@x.c', passwordHash: 'x', displayName: 'C' })
		.returning()
		.get();
	const t = db
		.insert(trips)
		.values({ ownerId: a.id, name: 'T', notes: 'CONF ABC123' })
		.returning()
		.get();
	db.insert(tripShares).values({ tripId: t.id, sharedWithUserId: b.id }).run();
	const g = db.insert(groups).values({ ownerId: a.id, name: 'fam' }).returning().get();
	db.insert(groupMembers).values({ groupId: g.id, userId: c.id }).run();
	db.insert(tripShares).values({ tripId: t.id, sharedWithGroupId: g.id }).run();

	expect(canView(a.id, t)).toBe(true);
	expect(canView(b.id, t)).toBe(true);
	expect(canView(c.id, t)).toBe(true);
	expect(canView(999, t)).toBe(false);
	expect(canEdit(b.id, t)).toBe(false);

	const proj = viewerProjection(t, [
		{
			type: 'flight',
			title: 'UA1',
			startAt: '2026-07-01T15:00:00Z',
			endAt: null,
			location: 'JFK',
			confirmationNumber: 'X',
			detailsJson: null
		} as any
	]);
	expect(JSON.stringify(proj)).not.toContain('CONF ABC123');
	expect(JSON.stringify(proj)).not.toContain('"confirmationNumber"');
});
