import { test, expect, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { parseCities1000Line, bulkInsertCities } from './geonames';
import { geonamesCities } from './db/schema';

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
	const db = (ctx as { db: import('./db').DB }).db;
	db.insert(geonamesCities)
		.values({ geonameId: 1, name: 'Old', asciiName: 'Old', countryCode: 'XX', lat: 0, lng: 0 })
		.run();

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
	const count = db.select({ count: sql<number>`count(*)` }).from(geonamesCities).get()!.count;
	expect(count).toBe(1);
	const row = db.select().from(geonamesCities).where(eq(geonamesCities.geonameId, 2988507)).get();
	expect(row?.name).toBe('Paris');
});
