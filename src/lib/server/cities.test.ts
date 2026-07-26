import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { citiesForGlobe, citySelectionError, findCity, resolveCitySelection, searchCities } from './cities';
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
	// Exact GeoNames match auto-resolves coordinates (typed name without picking from list)
	expect(citySelectionError('FR', 'Paris', undefined, undefined)).toBeNull();
	expect(citySelectionError('FR', 'Paris', 48.85, 2.35)).toBeNull();
});

test('resolveCitySelection fills lat/lng from GeoNames when maps are enabled', () => {
	updateSettings({ mapsEnabled: true });
	repo.importCitiesBatch([
		{ geonameId: 1, name: 'Bangkok', asciiName: 'Bangkok', countryCode: 'TH', lat: 13.75, lng: 100.5, population: 5000, timezone: null }
	]);
	const resolved = resolveCitySelection('TH', 'bangkok', undefined, undefined);
	expect(resolved).toEqual({
		ok: true,
		city: { name: 'Bangkok', admin1Code: null, lat: 13.75, lng: 100.5 }
	});
	const withCoords = resolveCitySelection('TH', 'Bangkok', 13.7525, 100.4942);
	expect(withCoords).toEqual({
		ok: true,
		city: { name: 'Bangkok', admin1Code: null, lat: 13.7525, lng: 100.4942 }
	});
});

test('resolveCitySelection leaves free-text cities alone when maps are disabled', () => {
	const resolved = resolveCitySelection('TH', 'Somewhere', undefined, undefined);
	expect(resolved).toEqual({
		ok: true,
		city: { name: 'Somewhere', admin1Code: null, lat: null, lng: null }
	});
});

test('findCity returns matching city', () => {
	repo.importCitiesBatch([
		{ geonameId: 1, name: 'Paris', asciiName: 'Paris', countryCode: 'FR', lat: 48.85, lng: 2.35, population: 1000, timezone: null }
	]);
	const result = findCity('FR', 'Paris');
	expect(result?.lat).toBe(48.85);
	expect(findCity('fr', 'paris')?.lat).toBe(48.85);
});

test('findCity picks highest population when multiple cities share a name', () => {
	repo.importCitiesBatch([
		{
			geonameId: 1,
			name: 'Dallas',
			asciiName: 'Dallas',
			countryCode: 'US',
			lat: 33.92,
			lng: -84.84,
			population: 14000,
			timezone: null
		},
		{
			geonameId: 2,
			name: 'Dallas',
			asciiName: 'Dallas',
			countryCode: 'US',
			lat: 32.78,
			lng: -96.8,
			population: 1300000,
			timezone: null
		}
	]);
	const city = findCity('US', 'Dallas');
	expect(city?.geonameId).toBe(2);
	expect(city?.lat).toBe(32.78);
});

test('resolveCitySelection keeps dropdown lat/lng even when a larger namesake exists', () => {
	updateSettings({ mapsEnabled: true });
	repo.importCitiesBatch([
		{
			geonameId: 1,
			name: 'Dallas',
			asciiName: 'Dallas',
			countryCode: 'US',
			lat: 33.92,
			lng: -84.84,
			population: 14000,
			timezone: null
		},
		{
			geonameId: 2,
			name: 'Dallas',
			asciiName: 'Dallas',
			countryCode: 'US',
			lat: 32.78,
			lng: -96.8,
			population: 1300000,
			timezone: null
		}
	]);
	// User picked the smaller Dallas from the autocomplete list
	const picked = resolveCitySelection('US', 'Dallas', 33.92, -84.84);
	expect(picked).toEqual({
		ok: true,
		city: { name: 'Dallas', admin1Code: null, lat: 33.92, lng: -84.84 }
	});
	// Typed name only → largest
	const typed = resolveCitySelection('US', 'Dallas', undefined, undefined);
	expect(typed).toEqual({
		ok: true,
		city: { name: 'Dallas', admin1Code: null, lat: 32.78, lng: -96.8 }
	});
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
