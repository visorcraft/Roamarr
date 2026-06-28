import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { citiesForGlobe, findCity, searchCities } from './cities';
import { geonamesCities } from './db/schema';

beforeEach(() => {
	(ctx as { sqlite: import('better-sqlite3').Database }).sqlite.exec('delete from geonames_cities;');
});

test('findCity returns matching city', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	db.insert(geonamesCities)
		.values({ geonameId: 1, name: 'Paris', asciiName: 'Paris', countryCode: 'FR', lat: 48.85, lng: 2.35, population: 1000 })
		.run();
	const result = findCity('FR', 'Paris');
	expect(result?.lat).toBe(48.85);
});

test('searchCities filters by country and prefix', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	db.insert(geonamesCities)
		.values([
			{ geonameId: 1, name: 'Paris', asciiName: 'Paris', countryCode: 'FR', lat: 48.85, lng: 2.35, population: 1000 },
			{ geonameId: 2, name: 'Lyon', asciiName: 'Lyon', countryCode: 'FR', lat: 45.76, lng: 4.83, population: 500 },
			{ geonameId: 3, name: 'Berlin', asciiName: 'Berlin', countryCode: 'DE', lat: 52.52, lng: 13.4, population: 2000 }
		])
		.run();
	expect(searchCities('FR', 'Par').map((c) => c.name)).toEqual(['Paris']);
	expect(searchCities('DE', 'Ber').map((c) => c.name)).toEqual(['Berlin']);
	expect(searchCities('FR', 'Lon')).toHaveLength(0);
});

test('citiesForGlobe returns top-population cities and maps lng to lon', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	db.insert(geonamesCities)
		.values([
			{ geonameId: 1, name: 'Big', asciiName: 'Big', countryCode: 'US', lat: 40, lng: -74, population: 9000 },
			{ geonameId: 2, name: 'Small', asciiName: 'Small', countryCode: 'US', lat: 41, lng: -73, population: 50 }
		])
		.run();
	const cities = citiesForGlobe();
	expect(cities[0]).toMatchObject({ id: 1, name: 'Big', lon: -74, population: 9000 });
	expect(cities).toHaveLength(2);
});

test('citiesForGlobe adds cities near the focus point even when not top-population', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	// 1100 high-pop cities far from the focus saturate the global top-1000 cut.
	const far = Array.from({ length: 1100 }, (_, i) => ({
		geonameId: 1000 + i,
		name: `Far${i}`,
		asciiName: `Far${i}`,
		countryCode: 'US',
		lat: 0,
		lng: 0,
		population: 100000 + i
	}));
	db.insert(geonamesCities).values(far).run();
	// A tiny city right at the focus point should still be included via the regional box.
	db.insert(geonamesCities)
		.values({ geonameId: 5, name: 'Nearby', asciiName: 'Nearby', countryCode: 'JP', lat: 35.6, lng: 139.7, population: 10 })
		.run();
	const ids = new Set(citiesForGlobe({ lat: 35.7, lng: 139.7 }).map((c) => c.id));
	expect(ids.has(5)).toBe(true);
});
