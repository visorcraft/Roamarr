import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { citiesForGlobe, citySelectionError, findCity, searchCities } from './cities';
import * as repo from './repositories/travelDataRepo';
import { geonamesCities } from './db/mongrelSchema';
import { updateSettings } from './settings';

beforeEach(() => {
	(ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit.deleteFrom(geonamesCities).executeSync();
	updateSettings({ mapsEnabled: false });
});

test('city selection validation follows map availability', () => {
	expect(citySelectionError('FR', 'Paris', undefined, undefined)).toBeNull();

	updateSettings({ mapsEnabled: true });
	expect(citySelectionError('FR', 'Paris', undefined, undefined)).toBe(
		'Please ask your Roamarr administrator to use “Re-import city database” under Configuration → Maps.'
	);

	repo.importCitiesBatch([
		{ geonameId: 1, name: 'Paris', asciiName: 'Paris', countryCode: 'FR', lat: 48.85, lng: 2.35, population: 1000, timezone: null }
	]);
	expect(citySelectionError('FR', 'London', 51.5, -0.1)).toBe(
		'Selected city was not found in the GeoNames database'
	);
	expect(citySelectionError('FR', 'Paris', undefined, undefined)).toBe('City coordinates are missing');
	expect(citySelectionError('FR', 'Paris', 48.85, 2.35)).toBeNull();
});

test('findCity returns matching city', () => {
	repo.importCitiesBatch([
		{ geonameId: 1, name: 'Paris', asciiName: 'Paris', countryCode: 'FR', lat: 48.85, lng: 2.35, population: 1000, timezone: null }
	]);
	const result = findCity('FR', 'Paris');
	expect(result?.lat).toBe(48.85);
	expect(findCity('fr', 'paris')?.lat).toBe(48.85);
});

test('searchCities filters by country and prefix', () => {
	repo.importCitiesBatch([
		{ geonameId: 1, name: 'Paris', asciiName: 'Paris', countryCode: 'FR', lat: 48.85, lng: 2.35, population: 1000, timezone: null },
		{ geonameId: 2, name: 'Lyon', asciiName: 'Lyon', countryCode: 'FR', lat: 45.76, lng: 4.83, population: 500, timezone: null },
		{ geonameId: 3, name: 'Berlin', asciiName: 'Berlin', countryCode: 'DE', lat: 52.52, lng: 13.4, population: 2000, timezone: null }
	]);
	expect(searchCities('FR', 'Par').map((c) => c.name)).toEqual(['Paris']);
	expect(searchCities('DE', 'Ber').map((c) => c.name)).toEqual(['Berlin']);
	expect(searchCities('FR', 'Lon')).toHaveLength(0);
});

test('citiesForGlobe returns top-population cities and maps lng to lon', () => {
	repo.importCitiesBatch([
		{ geonameId: 1, name: 'Big', asciiName: 'Big', countryCode: 'US', lat: 40, lng: -74, population: 9000, timezone: null },
		{ geonameId: 2, name: 'Small', asciiName: 'Small', countryCode: 'US', lat: 41, lng: -73, population: 50, timezone: null }
	]);
	const cities = citiesForGlobe();
	expect(cities[0]).toMatchObject({ id: 1, name: 'Big', lon: -74, population: 9000 });
	expect(cities).toHaveLength(2);
});

test('citiesForGlobe adds cities near the focus point even when not top-population', () => {
	const far = Array.from({ length: 1100 }, (_, i) => ({
		geonameId: 1000 + i,
		name: `Far${i}`,
		asciiName: `Far${i}`,
		countryCode: 'US',
		lat: 0,
		lng: 0,
		population: 100000 + i,
		timezone: null
	}));
	repo.importCitiesBatch(far);
	repo.importCitiesBatch([
		{ geonameId: 5, name: 'Nearby', asciiName: 'Nearby', countryCode: 'JP', lat: 35.6, lng: 139.7, population: 10, timezone: null }
	]);
	const ids = new Set(citiesForGlobe({ lat: 35.7, lng: 139.7 }).map((c) => c.id));
	expect(ids.has(5)).toBe(true);
});
