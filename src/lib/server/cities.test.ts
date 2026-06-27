import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { findCity, searchCities } from './cities';
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
