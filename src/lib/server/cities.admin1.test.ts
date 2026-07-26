import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	findCity,
	resolveCitySelection,
	searchCities,
	listAdmin1Options,
	countryUsesAdmin1
} from './cities';
import * as repo from './repositories/travelDataRepo';
import { geonamesCities, geonamesAdmin1 } from './db/mongrelSchema';
import { updateSettings } from './settings';

beforeEach(() => {
	const kit = (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
	kit.deleteFrom(geonamesCities).executeSync();
	kit.deleteFrom(geonamesAdmin1).executeSync();
	updateSettings({ mapsEnabled: true });
});

function seedDallasAmbiguity() {
	repo.importAdmin1Batch([
		{ countryCode: 'US', admin1Code: 'TX', name: 'Texas', asciiName: 'Texas' },
		{ countryCode: 'US', admin1Code: 'GA', name: 'Georgia', asciiName: 'Georgia' }
	]);
	repo.importCitiesBatch([
		{
			geonameId: 1,
			name: 'Dallas',
			asciiName: 'Dallas',
			countryCode: 'US',
			admin1Code: 'GA',
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
			admin1Code: 'TX',
			lat: 32.78,
			lng: -96.8,
			population: 1300000,
			timezone: null
		}
	]);
}

test('typed resolve without admin1 picks highest population in country', () => {
	seedDallasAmbiguity();
	const city = findCity('US', 'Dallas');
	expect(city?.admin1Code).toBe('TX');
	expect(city?.lat).toBe(32.78);
	const resolved = resolveCitySelection('US', 'Dallas', undefined, undefined, null);
	expect(resolved.ok && resolved.city.lat).toBe(32.78);
	expect(resolved.ok && resolved.city.admin1Code).toBe('TX');
});

test('typed resolve with admin1 scopes to that subdivision', () => {
	seedDallasAmbiguity();
	const ga = findCity('US', 'Dallas', 'GA');
	expect(ga?.geonameId).toBe(1);
	expect(ga?.lat).toBe(33.92);
	const resolved = resolveCitySelection('US', 'Dallas', undefined, undefined, 'GA');
	expect(resolved.ok && resolved.city.lat).toBe(33.92);
	expect(resolved.ok && resolved.city.admin1Code).toBe('GA');
});

test('explicit lat/lng from dropdown wins over population preference', () => {
	seedDallasAmbiguity();
	const resolved = resolveCitySelection('US', 'Dallas', 33.92, -84.84, 'GA');
	expect(resolved).toEqual({
		ok: true,
		city: { name: 'Dallas', admin1Code: 'GA', lat: 33.92, lng: -84.84 }
	});
});

test('searchCities filters by admin1 when provided', () => {
	seedDallasAmbiguity();
	const tx = searchCities('US', 'Dal', 20, 'TX');
	expect(tx).toHaveLength(1);
	expect(tx[0]!.admin1Code).toBe('TX');
	const ga = searchCities('US', 'Dal', 20, 'GA');
	expect(ga[0]!.admin1Code).toBe('GA');
});

test('listAdmin1Options and countryUsesAdmin1 reflect loaded labels', () => {
	seedDallasAmbiguity();
	expect(countryUsesAdmin1('US')).toBe(true);
	expect(countryUsesAdmin1('FR')).toBe(false);
	const opts = listAdmin1Options('US');
	expect(opts.map((o) => o.code).sort()).toEqual(['GA', 'TX']);
	expect(opts.find((o) => o.code === 'TX')?.name).toBe('Texas');
});
