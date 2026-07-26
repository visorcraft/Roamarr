import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { backfillMissingCityCoordinates } from './cityCoordsBackfill';
import * as travelRepo from './repositories/travelDataRepo';
import { geonamesCities, segments, trips } from './db/mongrelSchema';
import { makeUser } from '../../../tests/helpers';
import * as tripsRepo from './repositories/tripsRepo';
import * as segmentsRepo from './repositories/segmentsRepo';
import { eq } from '@visorcraft/mongreldb-kit';

beforeEach(() => {
	const kit = (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
	kit.deleteFrom(segments).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(geonamesCities).executeSync();
});

test('backfillMissingCityCoordinates is a no-op when the city database is empty', () => {
	const u = makeUser(ctx.kit);
	const t = tripsRepo.createTrip(u.id, {
		name: 'Trip',
		destinationCountryCode: 'TH',
		destinationCityName: 'Bangkok'
	});
	segmentsRepo.createSegment({
		trip_id: BigInt(t.id),
		type: 'hotel',
		title: 'Stay',
		start_at: '2026-08-01T10:00:00.000Z',
		start_tz: 'UTC',
		country_code: 'TH',
		city_name: 'Bangkok'
	});

	const result = backfillMissingCityCoordinates();
	expect(result).toEqual({
		segmentsUpdated: 0,
		tripsUpdated: 0,
		unresolved: 0,
		cityDatabaseEmpty: true
	});
});

test('backfillMissingCityCoordinates fills segment and trip coords from GeoNames', () => {
	travelRepo.importCitiesBatch([
		{
			geonameId: 1609350,
			name: 'Bangkok',
			asciiName: 'Bangkok',
			countryCode: 'TH',
			lat: 13.75,
			lng: 100.5,
			population: 5000000,
			timezone: 'Asia/Bangkok'
		},
		{
			geonameId: 1835848,
			name: 'Seoul',
			asciiName: 'Seoul',
			countryCode: 'KR',
			lat: 37.57,
			lng: 126.98,
			population: 10000000,
			timezone: 'Asia/Seoul'
		}
	]);

	const u = makeUser(ctx.kit);
	const t = tripsRepo.createTrip(u.id, {
		name: 'Trip',
		destinationCountryCode: 'TH',
		destinationCityName: 'bangkok' // case-insensitive match
	});
	const seg = segmentsRepo.createSegment({
		trip_id: BigInt(t.id),
		type: 'flight',
		title: 'ICN leg',
		start_at: '2026-08-01T10:00:00.000Z',
		start_tz: 'UTC',
		country_code: 'KR',
		city_name: 'Seoul'
	});
	// Already complete — should not be re-written / counted as unresolved
	const complete = segmentsRepo.createSegment({
		trip_id: BigInt(t.id),
		type: 'hotel',
		title: 'Stay',
		start_at: '2026-08-02T10:00:00.000Z',
		start_tz: 'UTC',
		country_code: 'TH',
		city_name: 'Bangkok',
		city_lat: 13.75398,
		city_lng: 100.50144
	});
	// Unknown city
	segmentsRepo.createSegment({
		trip_id: BigInt(t.id),
		type: 'note',
		title: 'Mystery',
		start_at: '2026-08-03T10:00:00.000Z',
		start_tz: 'UTC',
		country_code: 'TH',
		city_name: 'NotARealCityXYZ'
	});

	const result = backfillMissingCityCoordinates();
	expect(result.cityDatabaseEmpty).toBe(false);
	expect(result.segmentsUpdated).toBe(1);
	expect(result.tripsUpdated).toBe(1);
	expect(result.unresolved).toBe(1);

	const kit = (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
	const tripRow = kit.selectFrom(trips).where(eq(trips.id, BigInt(t.id))).executeSync()[0]!;
	expect(tripRow.destination_city_name).toBe('Bangkok');
	expect(tripRow.destination_city_lat).toBe(13.75);
	expect(tripRow.destination_city_lng).toBe(100.5);

	const segRow = kit.selectFrom(segments).where(eq(segments.id, BigInt(seg.id))).executeSync()[0]!;
	expect(segRow.city_name).toBe('Seoul');
	expect(segRow.city_lat).toBe(37.57);
	expect(segRow.city_lng).toBe(126.98);

	const completeRow = kit.selectFrom(segments).where(eq(segments.id, BigInt(complete.id))).executeSync()[0]!;
	expect(completeRow.city_lat).toBe(13.75398);
	expect(completeRow.city_lng).toBe(100.50144);
});

test('backfill respects stored admin1 so Dallas+GA is not rewritten as TX', () => {
	travelRepo.importCitiesBatch([
		{
			geonameId: 1,
			name: 'Dallas',
			asciiName: 'Dallas',
			countryCode: 'US',
			admin1Code: 'GA',
			lat: 33.92,
			lng: -84.84,
			population: 14000,
			timezone: 'America/New_York'
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
			timezone: 'America/Chicago'
		}
	]);

	const u = makeUser(ctx.kit);
	const t = tripsRepo.createTrip(u.id, {
		name: 'Georgia trip',
		destinationCountryCode: 'US',
		destinationAdmin1Code: 'GA',
		destinationCityName: 'Dallas'
		// no lat/lng — backfill should use GA
	});
	const seg = segmentsRepo.createSegment({
		trip_id: BigInt(t.id),
		type: 'hotel',
		title: 'Stay',
		start_at: '2026-08-01T10:00:00.000Z',
		start_tz: 'UTC',
		country_code: 'US',
		admin1_code: 'GA',
		city_name: 'Dallas'
	});

	const result = backfillMissingCityCoordinates();
	expect(result.segmentsUpdated).toBe(1);
	expect(result.tripsUpdated).toBe(1);
	expect(result.unresolved).toBe(0);

	const kit = (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
	const tripRow = kit.selectFrom(trips).where(eq(trips.id, BigInt(t.id))).executeSync()[0]!;
	expect(tripRow.destination_admin1_code).toBe('GA');
	expect(tripRow.destination_city_lat).toBe(33.92);
	expect(tripRow.destination_city_lng).toBe(-84.84);

	const segRow = kit.selectFrom(segments).where(eq(segments.id, BigInt(seg.id))).executeSync()[0]!;
	expect(segRow.admin1_code).toBe('GA');
	expect(segRow.city_lat).toBe(33.92);
	expect(segRow.city_lng).toBe(-84.84);
});
