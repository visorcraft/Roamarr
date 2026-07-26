import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { makeUser } from '../../../tests/helpers';
import * as tripsRepo from './repositories/tripsRepo';
import * as segmentsRepo from './repositories/segmentsRepo';
import { addSegment, updateSegment } from './segments';
import { eq } from '@visorcraft/mongreldb-kit';
import { trips, segments, geonamesCities, geonamesAdmin1 } from './db/mongrelSchema';
import * as repo from './repositories/travelDataRepo';
import { updateSettings } from './settings';

beforeEach(() => {
	const kit = (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
	kit.deleteFrom(segments).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(geonamesCities).executeSync();
	kit.deleteFrom(geonamesAdmin1).executeSync();
	updateSettings({ mapsEnabled: false });
});

test('trip create/update persists destinationAdmin1Code round-trip', () => {
	const kit = (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
	const u = makeUser(kit);
	const t = tripsRepo.createTrip(u.id, {
		name: 'Texas trip',
		destinationCountryCode: 'US',
		destinationAdmin1Code: 'TX',
		destinationCityName: 'Dallas',
		destinationCityLat: 32.78,
		destinationCityLng: -96.8
	});
	const loaded = tripsRepo.getTripById(t.id)!;
	expect(loaded.destinationAdmin1Code).toBe('TX');
	expect(loaded.destinationCountryCode).toBe('US');
	expect(loaded.destinationCityName).toBe('Dallas');

	tripsRepo.updateTrip(t.id, { destinationAdmin1Code: 'CA' });
	const again = kit.selectFrom(trips).where(eq(trips.id, BigInt(t.id))).executeSync()[0]!;
	expect(again.destination_admin1_code).toBe('CA');
});

test('segment add/update persists admin1Code round-trip', () => {
	const kit = (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
	const u = makeUser(kit);
	const t = tripsRepo.createTrip(u.id, { name: 'Trip' });
	const seg = addSegment(u.id, t.id, {
		type: 'hotel',
		title: 'Stay',
		localStart: '2026-08-01T15:00:00',
		startTz: 'America/Chicago',
		countryCode: 'US',
		admin1Code: 'TX',
		cityName: 'Dallas',
		cityLat: 32.78,
		cityLng: -96.8
	});
	const row = segmentsRepo.getSegmentById(seg.id)!;
	expect(row.admin1Code).toBe('TX');
	expect(row.cityName).toBe('Dallas');

	updateSegment(u.id, t.id, seg.id, {
		title: 'Stay',
		localStart: '2026-08-01T15:00:00',
		startTz: 'America/Chicago',
		countryCode: 'US',
		admin1Code: 'GA',
		cityName: 'Dallas',
		cityLat: 33.92,
		cityLng: -84.84
	});
	const updated = kit.selectFrom(segments).where(eq(segments.id, BigInt(seg.id))).executeSync()[0]!;
	expect(updated.admin1_code).toBe('GA');
});
