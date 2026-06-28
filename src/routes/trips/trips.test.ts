import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { kit } from '$lib/server/db';

import { makeUser, makeTrip, makeGroup, makeGroupMember, makeShare } from '../../../tests/helpers';


import { eq } from '@mongreldb/kit';
import { createTrip, loadTripFor } from './shared';
import { load, actions } from './+page.server';
import { upsertCustomReminder } from '$lib/server/reminders';
import { trips, reminders } from '$lib/server/db/mongrelSchema';
import { makeGetEvent } from '../../../tests/eventHelpers';

function event(user: { id: number; email: string }, search = '') {
	return makeGetEvent(user, {}, {}, `http://localhost/trips${search}`) as any;
}

test('owner sees full trip; non-owner without share is blocked', () => {
	const a = makeUser(kit, { email: 'a@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeUser(kit, { email: 'b@x.c', passwordHash: 'x', displayName: 'B' });
	const t = createTrip(a.id, { name: 'Trip', defaultVisibility: 'public' });
	expect(t.publicToken).toBeTruthy();
	expect(loadTripFor(a.id, t.id).owner).toBe(true);
	expect(() => loadTripFor(b.id, t.id)).toThrow();
});

test('trip list includes shared trips and labels them shared', () => {
	const a = makeUser(kit, { email: 'list-a@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeUser(kit, { email: 'list-b@x.c', passwordHash: 'x', displayName: 'B' });
	const c = makeUser(kit, { email: 'list-c@x.c', passwordHash: 'x', displayName: 'C' });

	makeTrip(kit, a.id, { name: 'Owned Trip', destinationCountryCode: 'FR', destinationCityName: 'Paris', destinationCityLat: 48.8566, destinationCityLng: 2.3522, startDate: '2026-07-01', notes: 'OWNER NOTE' });

	const shared = makeTrip(kit, a.id, { name: 'Shared Trip', destinationCountryCode: 'JP', destinationCityName: 'Tokyo', destinationCityLat: 35.6762, destinationCityLng: 139.6503, startDate: '2026-08-01', notes: 'SECRET' });
	makeShare(kit, { tripId: shared.id, sharedWithUserId: b.id });

	const groupTrip = makeTrip(kit, a.id, { name: 'Group Trip', destinationCountryCode: 'DE', destinationCityName: 'Berlin', destinationCityLat: 52.52, destinationCityLng: 13.405, startDate: '2026-09-01' });
	const g = makeGroup(kit, a.id, 'fam');
	makeGroupMember(kit, g.id, c.id);
	makeShare(kit, { tripId: groupTrip.id, sharedWithGroupId: g.id });

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
	const a = makeUser(kit, { email: 'sort-a@x.c', passwordHash: 'x', displayName: 'A' });

	makeTrip(kit, a.id, { name: 'Zulu', startDate: '2026-09-01' });
	makeTrip(kit, a.id, { name: 'Alpha', startDate: '2026-07-01' });
	makeTrip(kit, a.id, { name: 'Mike', startDate: '2026-08-01' });

	const result = load(event(a)) as any;
	expect(result.trips.map((t: any) => t.name)).toEqual(['Alpha', 'Mike', 'Zulu']);
	expect(result.sort).toBe('startDate');
	expect(result.order).toBe('asc');
});

test('trip list filters by query on name and destination', () => {
	const a = makeUser(kit, { email: 'q-a@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeUser(kit, { email: 'q-b@x.c', passwordHash: 'x', displayName: 'B' });

	makeTrip(kit, a.id, { name: 'Paris Trip', destinationCountryCode: 'FR', destinationCityName: 'Paris', destinationCityLat: 48.8566, destinationCityLng: 2.3522, startDate: '2026-07-01' });
	makeTrip(kit, a.id, { name: 'Tokyo Trip', destinationCountryCode: 'JP', destinationCityName: 'Tokyo', destinationCityLat: 35.6762, destinationCityLng: 139.6503, startDate: '2026-08-01' });
	const shared = makeTrip(kit, a.id, { name: 'Berlin Trip', destinationCountryCode: 'DE', destinationCityName: 'Berlin', destinationCityLat: 52.52, destinationCityLng: 13.405, startDate: '2026-09-01', notes: 'SECRET' });
	makeShare(kit, { tripId: shared.id, sharedWithUserId: b.id });

	const byName = load(event(a, '?q=tokyo')) as any;
	expect(byName.trips.map((t: any) => t.name)).toEqual(['Tokyo Trip']);

	const byDest = load(event(a, '?q=paris')) as any;
	expect(byDest.trips.map((t: any) => t.name)).toEqual(['Paris Trip']);

	const sharedFilter = load(event(b, '?q=berlin')) as any;
	expect(sharedFilter.trips.map((t: any) => t.name)).toEqual(['Berlin Trip']);
	expect(JSON.stringify(sharedFilter.trips)).not.toContain('SECRET');
});

test('trip list sorts by name and order', () => {
	const a = makeUser(kit, { email: 'name-a@x.c', passwordHash: 'x', displayName: 'A' });

	makeTrip(kit, a.id, { name: 'Zebra', startDate: '2026-09-01' });
	makeTrip(kit, a.id, { name: 'Apple', startDate: '2026-07-01' });
	makeTrip(kit, a.id, { name: 'Mango', startDate: '2026-08-01' });

	const asc = load(event(a, '?sort=name&order=asc')) as any;
	expect(asc.trips.map((t: any) => t.name)).toEqual(['Apple', 'Mango', 'Zebra']);

	const desc = load(event(a, '?sort=name&order=desc')) as any;
	expect(desc.trips.map((t: any) => t.name)).toEqual(['Zebra', 'Mango', 'Apple']);
});

test('trip list filters archived and favorite trips', () => {
	const a = makeUser(kit, { email: 'af-a@x.c', passwordHash: 'x', displayName: 'A' });
	makeTrip(kit, a.id, { name: 'Active', startDate: '2026-07-01' });
	makeTrip(kit, a.id, { name: 'Archived', startDate: '2026-08-01', archived: true });
	makeTrip(kit, a.id, { name: 'Favorite', startDate: '2026-09-01', favorite: true });

	const active = load(event(a, '?filter=active')) as any;
	expect(active.trips.map((t: any) => t.name).sort()).toEqual(['Active', 'Favorite']);

	const archived = load(event(a, '?filter=archived')) as any;
	expect(archived.trips.map((t: any) => t.name)).toEqual(['Archived']);

	const favorites = load(event(a, '?filter=favorites')) as any;
	expect(favorites.trips.map((t: any) => t.name)).toEqual(['Favorite']);
});

test('trip list filters by status', () => {
	const a = makeUser(kit, { email: 'status-a@x.c', passwordHash: 'x', displayName: 'A' });
	makeTrip(kit, a.id, { name: 'Planning Trip', startDate: '2026-07-01', status: 'planning' });
	makeTrip(kit, a.id, { name: 'Booked Trip', startDate: '2026-08-01', status: 'booked' });
	makeTrip(kit, a.id, { name: 'Active Trip', startDate: '2026-09-01', status: 'active' });
	makeTrip(kit, a.id, { name: 'Completed Trip', startDate: '2026-06-01', status: 'completed' });

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
	const a = makeUser(kit, { email: 'status-bad@x.c', passwordHash: 'x', displayName: 'A' });
	makeTrip(kit, a.id, { name: 'Only', startDate: '2026-07-01' });

	const bad = load(event(a, '?status=foo')) as any;
	expect(bad.trips.map((t: any) => t.name)).toEqual(['Only']);
	expect(bad.status).toBeUndefined();
});

test('trip list rejects invalid sort and order values', () => {
	const a = makeUser(kit, { email: 'bad-a@x.c', passwordHash: 'x', displayName: 'A' });
	makeTrip(kit, a.id, { name: 'Only', startDate: '2026-07-01' });

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
	const a = makeUser(kit, { email: 'bulk@x.c', passwordHash: 'x', displayName: 'A' });
	const t1 = makeTrip(kit, a.id, { name: 'A', archived: true, favorite: true });
	const t2 = makeTrip(kit, a.id, { name: 'B', archived: true, favorite: true });

	const unarchive = new FormData();
	unarchive.append('selected', String(t1.id));
	unarchive.append('selected', String(t2.id));
	await expect(actions.unarchive(makeEvent(a, unarchive))).rejects.toMatchObject({
		status: 303,
		location: '/trips'
	});
	expect(kit.selectFrom(trips).where(eq(trips.id, BigInt(t1.id))).executeSync()[0]!.archived).toBe(false);
	expect(kit.selectFrom(trips).where(eq(trips.id, BigInt(t2.id))).executeSync()[0]!.archived).toBe(false);

	const unfavorite = new FormData();
	unfavorite.append('selected', String(t1.id));
	await expect(actions.unfavorite(makeEvent(a, unfavorite))).rejects.toMatchObject({
		status: 303,
		location: '/trips'
	});
	expect(kit.selectFrom(trips).where(eq(trips.id, BigInt(t1.id))).executeSync()[0]!.favorite).toBe(false);
	expect(kit.selectFrom(trips).where(eq(trips.id, BigInt(t2.id))).executeSync()[0]!.favorite).toBe(true);
});


test('bulk delete removes trip-level and segment reminders', async () => {
	const a = makeUser(kit, { email: 'del-a@x.c', passwordHash: 'x', displayName: 'A' });
	const t = makeTrip(kit, a.id, { name: 'ToDelete', startDate: '2099-01-01' });
	upsertCustomReminder(a.id, 'trip', t.id, `${t.startDate}T09:00:00Z`, 60);
	expect(kit.selectFrom(reminders).where(eq(reminders.ref_type, 'trip')).executeSync()).toHaveLength(1);

	const body = new FormData();
	body.append('selected', String(t.id));
	await expect(actions.delete(makeEvent(a, body))).rejects.toMatchObject({ status: 303, location: '/trips' });
	expect(kit.selectFrom(trips).where(eq(trips.id, BigInt(t.id))).executeSync()[0]).toBeUndefined();
	expect(kit.selectFrom(reminders).where(eq(reminders.ref_type, 'trip')).executeSync()).toHaveLength(0);
});
