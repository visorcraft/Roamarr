import { test, expect, vi } from 'vitest';
import { eq } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { parseCities1000Line, bulkInsertCities } from './geonames';
import { geonamesCities } from './db/mongrelSchema';

const SAMPLE_LINE =
	'2988507\tParis\tParis\t\t48.8534\t2.3488\tP\tPPLC\tFR\t\t\t11\t\t\t2161000\t\t\tEurope/Paris\t2024-01-01';

test('parseCities1000Line extracts required fields', () => {
	const row = parseCities1000Line(SAMPLE_LINE);
	expect(row).not.toBeNull();
	expect(row!.geonameId).toBe(2988507);
	expect(row!.name).toBe('Paris');
	expect(row!.asciiName).toBe('Paris');
	expect(row!.countryCode).toBe('FR');
	expect(row!.lat).toBe(48.8534);
	expect(row!.lng).toBe(2.3488);
	expect(row!.population).toBe(2161000);
	expect(row!.timezone).toBe('Europe/Paris');
});

test('parseCities1000Line returns null for malformed lines', () => {
	expect(parseCities1000Line('')).toBeNull();
	expect(parseCities1000Line('# comment')).toBeNull();
	expect(parseCities1000Line('1\tOnlyName')).toBeNull();
});

test('parseCities1000Line rejects invalid numbers', () => {
	expect(parseCities1000Line('1\tX\tX\t\tx\t2.0\tP\tPPLC\tFR\t\t\t11\t\t\t100\t\t\tEurope/Paris')).toBeNull();
	expect(parseCities1000Line('1\tX\tX\t\t1.0\ty\tP\tPPLC\tFR\t\t\t11\t\t\t100\t\t\tEurope/Paris')).toBeNull();
	expect(parseCities1000Line('1\tX\tX\t\t1.0\t2.0\tP\tPPLC\tFR\t\t\t11\t\t\tbadpop\t\t\tEurope/Paris')).toBeNull();
});

test('bulkInsertCities replaces existing data and inserts rows', () => {
	const kit = (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
	kit
		.insertInto(geonamesCities)
		.values({ geoname_id: BigInt(1), name: 'Old', ascii_name: 'Old', country_code: 'XX', lat: 0, lng: 0 })
		.executeSync();

	const imported = bulkInsertCities([
		{
			geonameId: 2988507,
			name: 'Paris',
			asciiName: 'Paris',
			countryCode: 'FR',
			lat: 48.8534,
			lng: 2.3488,
			population: 2161000,
			timezone: 'Europe/Paris'
		}
	]);

	expect(imported).toBe(1);
	const count = kit.selectFrom(geonamesCities).selectCount().executeSync();
	expect(count).toBe(1n);
	const row = kit.selectFrom(geonamesCities).where(eq(geonamesCities.geoname_id, BigInt(2988507))).executeSync()[0];
	expect(row?.name).toBe('Paris');
});
