import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load } from './+page.server';
import { users, trips } from '$lib/server/db/schema';
import { makeGetEvent } from '../../../tests/eventHelpers';

function event(user: { id: number; email: string }, search = '') {
	return makeGetEvent(user, {}, {}, `http://localhost/search${search}`) as any;
}

test('search page requires a user', () => {
	const ev = {
		locals: { user: null },
		url: new URL('http://localhost/search'),
		request: { method: 'GET', formData: async () => new FormData() }
	} as any;
	expect(() => load(ev)).toThrow();
});

test('search with no query returns empty results', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'search-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	db.insert(trips).values({ ownerId: a.id, name: 'Paris Trip', destinationCountryCode: 'FR', destinationCityName: 'Paris', destinationCityLat: 48.8566, destinationCityLng: 2.3522, startDate: '2026-07-01' }).run();

	const result = load(event(a)) as any;
	expect(result.trips).toHaveLength(0);
	expect(result.q).toBeUndefined();
});

test('search filters trips by name and destination', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'search-b@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();

	db.insert(trips).values({ ownerId: a.id, name: 'Tokyo Trip', destinationCountryCode: 'JP', destinationCityName: 'Tokyo', destinationCityLat: 35.6762, destinationCityLng: 139.6503, startDate: '2026-08-01' }).run();
	db.insert(trips).values({ ownerId: a.id, name: 'Paris Trip', destinationCountryCode: 'FR', destinationCityName: 'Paris', destinationCityLat: 48.8566, destinationCityLng: 2.3522, startDate: '2026-07-01' }).run();

	const result = load(event(a, '?q=tokyo')) as any;
	expect(result.trips.map((t: any) => t.name)).toEqual(['Tokyo Trip']);
	expect(result.q).toBe('tokyo');
});

test('search excludes archived trips by default', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'search-c@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();

	db.insert(trips).values({ ownerId: a.id, name: 'Active Tokyo', destinationCountryCode: 'JP', destinationCityName: 'Tokyo', destinationCityLat: 35.6762, destinationCityLng: 139.6503, startDate: '2026-08-01' }).run();
	db.insert(trips).values({ ownerId: a.id, name: 'Archived Tokyo', destinationCountryCode: 'JP', destinationCityName: 'Tokyo', destinationCityLat: 35.6762, destinationCityLng: 139.6503, startDate: '2026-09-01', archived: true }).run();

	const result = load(event(a, '?q=tokyo')) as any;
	expect(result.trips.map((t: any) => t.name)).toEqual(['Active Tokyo']);
});

test('search trims whitespace-only queries', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'search-d@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();

	db.insert(trips).values({ ownerId: a.id, name: 'Tokyo Trip', destinationCountryCode: 'JP', destinationCityName: 'Tokyo', destinationCityLat: 35.6762, destinationCityLng: 139.6503, startDate: '2026-08-01' }).run();

	const result = load(event(a, '?q=%20%20')) as any;
	expect(result.trips).toHaveLength(0);
	expect(result.q).toBeUndefined();
});
