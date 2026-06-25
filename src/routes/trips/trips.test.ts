import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { eq } from 'drizzle-orm';
import { createTrip, loadTripFor } from './shared';
import { load, actions } from './+page.server';
import { upsertCustomReminder } from '$lib/server/reminders';
import { users, trips, groups, groupMembers, tripShares, reminders } from '$lib/server/db/schema';

function event(user: { id: number }, search = '') {
	return { locals: { user } as App.Locals, url: new URL(`http://localhost/trips${search}`) } as any;
}

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

test('trip list includes shared trips and labels them shared', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'list-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'list-b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const c = db.insert(users).values({ email: 'list-c@x.c', passwordHash: 'x', displayName: 'C' }).returning().get();

	db.insert(trips)
		.values({ ownerId: a.id, name: 'Owned Trip', destination: 'Paris', startDate: '2026-07-01', notes: 'OWNER NOTE' })
		.run();

	const shared = db
		.insert(trips)
		.values({ ownerId: a.id, name: 'Shared Trip', destination: 'Tokyo', startDate: '2026-08-01', notes: 'SECRET' })
		.returning()
		.get();
	db.insert(tripShares).values({ tripId: shared.id, sharedWithUserId: b.id }).run();

	const groupTrip = db
		.insert(trips)
		.values({ ownerId: a.id, name: 'Group Trip', destination: 'Berlin', startDate: '2026-09-01' })
		.returning()
		.get();
	const g = db.insert(groups).values({ ownerId: a.id, name: 'fam' }).returning().get();
	db.insert(groupMembers).values({ groupId: g.id, userId: c.id }).run();
	db.insert(tripShares).values({ tripId: groupTrip.id, sharedWithGroupId: g.id }).run();

	const forB = load(event(b)) as any;
	expect(forB.trips.map((t: any) => t.name)).toEqual(['Shared Trip']);
	expect(forB.trips[0].isShared).toBe(true);
	expect(JSON.stringify(forB.trips)).not.toContain('SECRET');

	const forC = load(event(c)) as any;
	expect(forC.trips.map((t: any) => t.name)).toEqual(['Group Trip']);
	expect(forC.trips[0].isShared).toBe(true);

	const forA = load(event(a)) as any;
	expect(forA.trips.map((t: any) => t.name).sort()).toEqual(['Group Trip', 'Owned Trip', 'Shared Trip']);
	expect(forA.trips.find((t: any) => t.name === 'Owned Trip')?.isShared).toBe(false);
	expect(forA.trips.find((t: any) => t.name === 'Owned Trip')?.defaultVisibility).toBe('private');
});

test('trip list defaults to startDate ascending', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'sort-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();

	db.insert(trips).values({ ownerId: a.id, name: 'Zulu', destination: 'Z', startDate: '2026-09-01' }).run();
	db.insert(trips).values({ ownerId: a.id, name: 'Alpha', destination: 'A', startDate: '2026-07-01' }).run();
	db.insert(trips).values({ ownerId: a.id, name: 'Mike', destination: 'M', startDate: '2026-08-01' }).run();

	const result = load(event(a)) as any;
	expect(result.trips.map((t: any) => t.name)).toEqual(['Alpha', 'Mike', 'Zulu']);
	expect(result.sort).toBe('startDate');
	expect(result.order).toBe('asc');
});

test('trip list filters by query on name and destination', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'q-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'q-b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();

	db.insert(trips).values({ ownerId: a.id, name: 'Paris Trip', destination: 'Paris', startDate: '2026-07-01' }).run();
	db.insert(trips).values({ ownerId: a.id, name: 'Tokyo Trip', destination: 'Tokyo', startDate: '2026-08-01' }).run();
	const shared = db.insert(trips).values({ ownerId: a.id, name: 'Berlin Trip', destination: 'Berlin', startDate: '2026-09-01', notes: 'SECRET' }).returning().get();
	db.insert(tripShares).values({ tripId: shared.id, sharedWithUserId: b.id }).run();

	const byName = load(event(a, '?q=tokyo')) as any;
	expect(byName.trips.map((t: any) => t.name)).toEqual(['Tokyo Trip']);

	const byDest = load(event(a, '?q=paris')) as any;
	expect(byDest.trips.map((t: any) => t.name)).toEqual(['Paris Trip']);

	const sharedFilter = load(event(b, '?q=berlin')) as any;
	expect(sharedFilter.trips.map((t: any) => t.name)).toEqual(['Berlin Trip']);
	expect(JSON.stringify(sharedFilter.trips)).not.toContain('SECRET');
});

test('trip list sorts by name and order', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'name-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();

	db.insert(trips).values({ ownerId: a.id, name: 'Zebra', destination: 'Z', startDate: '2026-09-01' }).run();
	db.insert(trips).values({ ownerId: a.id, name: 'Apple', destination: 'A', startDate: '2026-07-01' }).run();
	db.insert(trips).values({ ownerId: a.id, name: 'Mango', destination: 'M', startDate: '2026-08-01' }).run();

	const asc = load(event(a, '?sort=name&order=asc')) as any;
	expect(asc.trips.map((t: any) => t.name)).toEqual(['Apple', 'Mango', 'Zebra']);

	const desc = load(event(a, '?sort=name&order=desc')) as any;
	expect(desc.trips.map((t: any) => t.name)).toEqual(['Zebra', 'Mango', 'Apple']);
});

test('trip list filters archived and favorite trips', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'af-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	db.insert(trips).values({ ownerId: a.id, name: 'Active', startDate: '2026-07-01' }).run();
	db.insert(trips).values({ ownerId: a.id, name: 'Archived', startDate: '2026-08-01', archived: true }).run();
	db.insert(trips).values({ ownerId: a.id, name: 'Favorite', startDate: '2026-09-01', favorite: true }).run();

	const active = load(event(a, '?filter=active')) as any;
	expect(active.trips.map((t: any) => t.name).sort()).toEqual(['Active', 'Favorite']);

	const archived = load(event(a, '?filter=archived')) as any;
	expect(archived.trips.map((t: any) => t.name)).toEqual(['Archived']);

	const favorites = load(event(a, '?filter=favorites')) as any;
	expect(favorites.trips.map((t: any) => t.name)).toEqual(['Favorite']);
});

test('trip list filters by status', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'status-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	db.insert(trips).values({ ownerId: a.id, name: 'Planning Trip', startDate: '2026-07-01', status: 'planning' }).run();
	db.insert(trips).values({ ownerId: a.id, name: 'Booked Trip', startDate: '2026-08-01', status: 'booked' }).run();
	db.insert(trips).values({ ownerId: a.id, name: 'Active Trip', startDate: '2026-09-01', status: 'active' }).run();
	db.insert(trips).values({ ownerId: a.id, name: 'Completed Trip', startDate: '2026-06-01', status: 'completed' }).run();

	const planning = load(event(a, '?status=planning')) as any;
	expect(planning.trips.map((t: any) => t.name)).toEqual(['Planning Trip']);
	expect(planning.status).toBe('planning');

	const active = load(event(a, '?status=active')) as any;
	expect(active.trips.map((t: any) => t.name)).toEqual(['Active Trip']);

	const all = load(event(a)) as any;
	expect(all.trips.map((t: any) => t.name).sort()).toEqual(['Active Trip', 'Booked Trip', 'Completed Trip', 'Planning Trip']);
	expect(all.status).toBeUndefined();
});

test('trip list rejects invalid status values', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'status-bad@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	db.insert(trips).values({ ownerId: a.id, name: 'Only', startDate: '2026-07-01' }).run();

	const bad = load(event(a, '?status=foo')) as any;
	expect(bad.trips.map((t: any) => t.name)).toEqual(['Only']);
	expect(bad.status).toBeUndefined();
});

test('trip list rejects invalid sort and order values', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'bad-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	db.insert(trips).values({ ownerId: a.id, name: 'Only', destination: 'O', startDate: '2026-07-01' }).run();

	const badSort = load(event(a, '?sort=ownerId&order=asc')) as any;
	expect(badSort.trips.map((t: any) => t.name)).toEqual(['Only']);
	expect(badSort.sort).toBe('startDate');

	const badOrder = load(event(a, '?sort=name&order=side')) as any;
	expect(badOrder.trips.map((t: any) => t.name)).toEqual(['Only']);
	expect(badOrder.order).toBe('asc');
});


function makeEvent(user: { id: number }, body: FormData) {
	return {
		locals: { user } as App.Locals,
		request: { formData: async () => body } as Request
	} as any;
}

test('bulk unarchive and unfavorite actions update selected trips', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'bulk@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const t1 = db.insert(trips).values({ ownerId: a.id, name: 'A', archived: true, favorite: true }).returning().get();
	const t2 = db.insert(trips).values({ ownerId: a.id, name: 'B', archived: true, favorite: true }).returning().get();

	const unarchive = new FormData();
	unarchive.append('selected', String(t1.id));
	unarchive.append('selected', String(t2.id));
	await expect(actions.unarchive(makeEvent(a, unarchive))).rejects.toMatchObject({
		status: 303,
		location: '/trips'
	});
	expect(db.select().from(trips).where(eq(trips.id, t1.id)).get()!.archived).toBe(false);
	expect(db.select().from(trips).where(eq(trips.id, t2.id)).get()!.archived).toBe(false);

	const unfavorite = new FormData();
	unfavorite.append('selected', String(t1.id));
	await expect(actions.unfavorite(makeEvent(a, unfavorite))).rejects.toMatchObject({
		status: 303,
		location: '/trips'
	});
	expect(db.select().from(trips).where(eq(trips.id, t1.id)).get()!.favorite).toBe(false);
	expect(db.select().from(trips).where(eq(trips.id, t2.id)).get()!.favorite).toBe(true);
});


test('bulk delete removes trip-level and segment reminders', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'del-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'ToDelete', startDate: '2099-01-01' }).returning().get();
	upsertCustomReminder(a.id, 'trip', t.id, `${t.startDate}T09:00:00Z`, 60);
	expect(db.select().from(reminders).where(eq(reminders.refType, 'trip')).all()).toHaveLength(1);

	const body = new FormData();
	body.append('selected', String(t.id));
	await expect(actions.delete(makeEvent(a, body))).rejects.toMatchObject({ status: 303, location: '/trips' });
	expect(db.select().from(trips).where(eq(trips.id, t.id)).get()).toBeUndefined();
	expect(db.select().from(reminders).where(eq(reminders.refType, 'trip')).all()).toHaveLength(0);
});
