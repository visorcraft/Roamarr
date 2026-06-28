import { test, expect, vi, beforeEach } from 'vitest';
import { eq } from '@mongreldb/kit';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { parseJson, parseCsv, importTrips } from './import';
import { exportTripsCsv } from './export';
import { users, trips, segments, reminders, auditLogs } from './db/mongrelSchema';
import * as usersRepo from './repositories/usersRepo';
import * as tripsRepo from './repositories/tripsRepo';
import * as segmentsRepo from './repositories/segmentsRepo';

beforeEach(() => {
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	kit.deleteFrom(reminders).executeSync();
	kit.deleteFrom(segments).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(auditLogs).executeSync();
	kit.deleteFrom(users).executeSync();
});

function makeUser(email = 'u@x.c') {
	return usersRepo.createUser({
		email,
		password_hash: 'x',
		display_name: 'U',
		calendar_token: null,
		calendar_token_expires_at: null
	});
}

function makeTrip(ownerId: number, name: string) {
	return tripsRepo.createTrip(ownerId, { name, startDate: '2026-08-01', endDate: '2026-08-10' });
}

function makeSegment(tripId: number, type: string, title: string, startAt: string) {
	return segmentsRepo.createSegment({
		trip_id: BigInt(tripId),
		type: type as any,
		title,
		start_at: startAt,
		start_tz: 'UTC'
	});
}

test('parseJson accepts a trips array', () => {
	const input = JSON.stringify({
		trips: [
			{
				name: 'Tokyo',
				startDate: '2026-08-01',
				segments: [{ type: 'flight', title: 'Out', localStart: '2026-08-01T10:00', startTz: 'UTC' }]
			}
		]
	});
	const parsed = parseJson(input);
	expect(parsed.trips).toHaveLength(1);
	expect(parsed.trips[0]!.name).toBe('Tokyo');
});

test('parseJson rejects malformed JSON', () => {
	expect(() => parseJson('not json')).toThrow();
	expect(() => parseJson('{"trips": "no"}')).toThrow('trips array');
});

test('parseCsv accepts a header and data rows', () => {
	const csv =
		'name,destinationCountryCode,destinationCityName,destinationCityLat,destinationCityLng,startDate,endDate,segmentType,segmentTitle,segmentLocalStart,segmentStartTz\nTokyo,JP,Tokyo,35.6762,139.6503,2026-08-01,2026-08-10,flight,Out,2026-08-01T10:00,UTC';
	const parsed = parseCsv(csv);
	expect(parsed.trips).toHaveLength(1);
	expect(parsed.trips[0]!.name).toBe('Tokyo');
	expect(parsed.trips[0]!.segments).toHaveLength(1);
	expect(parsed.trips[0]!.segments![0]!.type).toBe('flight');
});

test('parseCsv handles commas inside quoted values', () => {
	const csv = 'name,destinationCityName\n"Summer, Escape","Lisbon, Portugal"';
	const parsed = parseCsv(csv);
	expect(parsed.trips[0]!.name).toBe('Summer, Escape');
	expect(parsed.trips[0]!.destinationCityName).toBe('Lisbon, Portugal');
});

test('importTrips creates trips and segments', () => {
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	const u = makeUser();
	const result = importTrips(Number(u.id), {
		trips: [
			{
				name: 'Tokyo',
				destinationCountryCode: 'JP',
				destinationCityName: 'Tokyo',
				destinationCityLat: 35.6762,
				destinationCityLng: 139.6503,
				startDate: '2026-08-01',
				endDate: '2026-08-10',
				segments: [
					{
						type: 'flight',
						title: 'Outbound',
						localStart: '2026-08-01T10:00',
						startTz: 'America/New_York',
						location: 'JFK'
					}
				]
			}
		]
	});
	expect(result.imported).toBe(1);
	expect(result.segmentCount).toBe(1);
	expect(result.errors).toHaveLength(0);
	const t = kit.selectFrom(trips).where(eq(trips.owner_id, BigInt(u.id))).executeSync()[0];
	expect(t).toBeDefined();
	expect(t!.name).toBe('Tokyo');
	const s = kit.selectFrom(segments).where(eq(segments.trip_id, t!.id)).executeSync()[0];
	expect(s).toBeDefined();
	expect(s!.type).toBe('flight');
	expect(kit.selectFrom(reminders).executeSync()).toHaveLength(1);
	expect(kit.selectFrom(auditLogs).executeSync()).toHaveLength(1);
});

test('importTrips mints public token for public visibility', () => {
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	const u = makeUser();
	importTrips(Number(u.id), {
		trips: [{ name: 'Public Trip', defaultVisibility: 'public' }]
	});
	const t = kit.selectFrom(trips).where(eq(trips.owner_id, BigInt(u.id))).executeSync()[0];
	expect(t!.public_token).toBeTruthy();
});

test('importTrips collects validation errors without creating invalid trips', () => {
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	const u = makeUser();
	const result = importTrips(Number(u.id), {
		trips: [
			{ name: '', startDate: 'bad', endDate: '2026-01-01' },
			{ name: 'Good', startDate: '2026-08-01', endDate: '2026-08-10' }
		]
	});
	expect(result.imported).toBe(1);
	expect(result.errors.length).toBeGreaterThan(0);
	expect(kit.selectFrom(trips).where(eq(trips.owner_id, BigInt(u.id))).executeSync()).toHaveLength(1);
});

test('importTrips skips invalid segments but keeps the trip', () => {
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	const u = makeUser();
	const result = importTrips(Number(u.id), {
		trips: [
			{
				name: 'Mixed',
				segments: [
					{ type: 'flight', title: 'Good', localStart: '2099-01-01T10:00', startTz: 'UTC' },
					{ type: 'bad' as any, title: 'Bad', localStart: 'not-a-date', startTz: 'UTC' }
				]
			}
		]
	});
	expect(result.imported).toBe(1);
	expect(result.segmentCount).toBe(1);
	expect(result.errors.length).toBeGreaterThan(0);
	const t = kit.selectFrom(trips).where(eq(trips.owner_id, BigInt(u.id))).executeSync()[0];
	expect(kit.selectFrom(segments).where(eq(segments.trip_id, t!.id)).executeSync()).toHaveLength(1);
});

test('importTrips dryRun validates and previews without writing', () => {
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	const u = makeUser('dry@x.c');
	const beforeTrips = kit.selectFrom(trips).where(eq(trips.owner_id, BigInt(u.id))).executeSync().length;
	const result = importTrips(
		Number(u.id),
		{
			trips: [
				{
					name: 'Dry',
					startDate: '2026-07-01',
					segments: [{ type: 'flight', title: 'F', localStart: '2026-07-01T10:00', startTz: 'UTC' }]
				}
			]
		},
		true
	);
	expect(result.imported).toBe(1);
	expect(result.segmentCount).toBe(1);
	expect(result.preview).toHaveLength(1);
	expect(result.preview![0].name).toBe('Dry');
	expect(kit.selectFrom(trips).where(eq(trips.owner_id, BigInt(u.id))).executeSync().length).toBe(beforeTrips);
	expect(kit.selectFrom(segments).executeSync().length).toBe(0);
});

test('parseCsv groups multi-segment rows into one trip', () => {
	const csv = [
		'name,destinationCountryCode,destinationCityName,destinationCityLat,destinationCityLng,startDate,endDate,segmentType,segmentTitle,segmentLocalStart,segmentStartTz',
		'Tokyo,JP,Tokyo,35.6762,139.6503,2026-08-01,2026-08-10,flight,Out,2026-08-01T10:00,UTC',
		'Tokyo,JP,Tokyo,35.6762,139.6503,2026-08-01,2026-08-10,hotel,Stay,2026-08-05T16:00,UTC'
	].join('\n');
	const parsed = parseCsv(csv);
	expect(parsed.trips).toHaveLength(1);
	expect(parsed.trips[0].segments).toHaveLength(2);
	expect(parsed.trips[0].segments![0].type).toBe('flight');
	expect(parsed.trips[0].segments![1].type).toBe('hotel');
});

test('csv round-trip preserves multi-segment trips', () => {
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	const u = makeUser('round@x.c');
	const t = makeTrip(Number(u.id), 'RT');
	makeSegment(t.id, 'flight', 'Out', '2026-08-01T10:00:00Z');
	makeSegment(t.id, 'hotel', 'Stay', '2026-08-05T16:00:00Z');

	const csv = exportTripsCsv(Number(u.id));
	const result = importTrips(Number(u.id), parseCsv(csv));
	expect(result.imported).toBe(1);
	expect(result.segmentCount).toBe(2);
	expect(kit.selectFrom(trips).where(eq(trips.owner_id, BigInt(u.id))).executeSync()).toHaveLength(2);
});
