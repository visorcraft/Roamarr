import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { kit } from '$lib/server/db';

import { makeUser, makeTrip } from '../../../tests/helpers';

import { load } from './+page.server';
import { makeGetEvent } from '../../../tests/eventHelpers';

function event(user: { id: number; email: string }, search = '') {
	return makeGetEvent(user, {}, {}, `http://localhost/search${search}`) as any;
}

test('search page requires a user', async () => {
	const ev = {
		locals: { user: null },
		url: new URL('http://localhost/search'),
		request: { method: 'GET', formData: async () => new FormData() }
	} as any;
	await expect(load(ev)).rejects.toMatchObject({ status: 401 });
});

test('search with no query returns empty results', async () => {
	const a = makeUser(kit, { email: 'search-a@x.c', passwordHash: 'x', displayName: 'A' });
	makeTrip(kit, a.id, {
		name: 'Paris Trip',
		destinationCountryCode: 'FR',
		destinationCityName: 'Paris',
		destinationCityLat: 48.8566,
		destinationCityLng: 2.3522,
		startDate: '2026-07-01'
	});

	const result = (await load(event(a))) as any;
	expect(result.trips).toHaveLength(0);
	expect(result.q).toBeUndefined();
});

test('search filters trips by name and destination', async () => {
	const a = makeUser(kit, { email: 'search-b@x.c', passwordHash: 'x', displayName: 'A' });

	makeTrip(kit, a.id, {
		name: 'Tokyo Trip',
		destinationCountryCode: 'JP',
		destinationCityName: 'Tokyo',
		destinationCityLat: 35.6762,
		destinationCityLng: 139.6503,
		startDate: '2026-08-01'
	});
	makeTrip(kit, a.id, {
		name: 'Paris Trip',
		destinationCountryCode: 'FR',
		destinationCityName: 'Paris',
		destinationCityLat: 48.8566,
		destinationCityLng: 2.3522,
		startDate: '2026-07-01'
	});

	const result = (await load(event(a, '?q=tokyo'))) as any;
	expect(result.trips.map((t: any) => t.name)).toEqual(['Tokyo Trip']);
	expect(result.q).toBe('tokyo');
});

test('search excludes archived trips by default', async () => {
	const a = makeUser(kit, { email: 'search-c@x.c', passwordHash: 'x', displayName: 'A' });

	makeTrip(kit, a.id, {
		name: 'Active Tokyo',
		destinationCountryCode: 'JP',
		destinationCityName: 'Tokyo',
		destinationCityLat: 35.6762,
		destinationCityLng: 139.6503,
		startDate: '2026-08-01'
	});
	makeTrip(kit, a.id, {
		name: 'Archived Tokyo',
		destinationCountryCode: 'JP',
		destinationCityName: 'Tokyo',
		destinationCityLat: 35.6762,
		destinationCityLng: 139.6503,
		startDate: '2026-09-01',
		archived: true
	});

	const result = (await load(event(a, '?q=tokyo'))) as any;
	expect(result.trips.map((t: any) => t.name)).toEqual(['Active Tokyo']);
});

test('search trims whitespace-only queries', async () => {
	const a = makeUser(kit, { email: 'search-d@x.c', passwordHash: 'x', displayName: 'A' });

	makeTrip(kit, a.id, {
		name: 'Tokyo Trip',
		destinationCountryCode: 'JP',
		destinationCityName: 'Tokyo',
		destinationCityLat: 35.6762,
		destinationCityLng: 139.6503,
		startDate: '2026-08-01'
	});

	const result = (await load(event(a, '?q=%20%20'))) as any;
	expect(result.trips).toHaveLength(0);
	expect(result.q).toBeUndefined();
});
