import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { exportTrips, exportTripsJson, exportTripsCsv } from './export';
import { parseCsv } from './import';
import { users, trips, segments, tripMailHolds } from './db/mongrelSchema';
import * as usersRepo from './repositories/usersRepo';
import * as tripsRepo from './repositories/tripsRepo';
import * as segmentsRepo from './repositories/segmentsRepo';
import { createMailHold } from './repositories/tripMiscRepo';

beforeEach(() => {
	const kit = (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
	kit.deleteFrom(segments).executeSync();
	kit.deleteFrom(tripMailHolds).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
});

function makeUser(email: string) {
	return usersRepo.createUser({
		email,
		password_hash: 'x',
		display_name: email,
		calendar_token: null,
		calendar_token_expires_at: null
	});
}

function makeTrip(ownerId: number, name: string, extra: Record<string, unknown> = {}) {
	return tripsRepo.createTrip(ownerId, { name, ...extra } as any);
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

test('exportTrips returns only owned trips with segments', () => {
	const owner = makeUser('o@x.c');
	const other = makeUser('x@x.c');
	const t1 = makeTrip(Number(owner.id), 'Mine', {
		destinationCountryCode: 'FR',
		destinationCityName: 'Paris',
		destinationCityLat: 48.8566,
		destinationCityLng: 2.3522,
		startDate: '2026-07-01',
		tags: '["work"]'
	});
	makeSegment(t1.id, 'flight', 'AF1', '2026-07-01T08:00:00Z');
	makeTrip(Number(other.id), 'Not mine');

	const exported = exportTrips(Number(owner.id));
	expect(exported).toHaveLength(1);
	expect(exported[0].name).toBe('Mine');
	expect(exported[0].tags).toEqual(['work']);
	expect(exported[0].segments).toHaveLength(1);
	expect(exported[0].segments![0].title).toBe('AF1');
});

test('exportTripsJson returns parseable JSON', () => {
	const owner = makeUser('j@x.c');
	makeTrip(Number(owner.id), 'JSON trip');
	const json = exportTripsJson(Number(owner.id));
	const parsed = JSON.parse(json);
	expect(parsed.trips).toHaveLength(1);
	expect(parsed.trips[0].name).toBe('JSON trip');
});

test('exportTripsCsv includes header and trip row', () => {
	const owner = makeUser('c@x.c');
	makeTrip(Number(owner.id), 'CSV trip', { startDate: '2026-08-01' });
	const csv = exportTripsCsv(Number(owner.id));
	const lines = csv.trim().split('\n');
	expect(lines[0]).toContain('name');
	expect(lines[1]).toContain('CSV trip');
});

test('exportTripsCsv emits one row per segment and round-trips', () => {
	const owner = makeUser('rt@x.c');
	const t = makeTrip(Number(owner.id), 'RT', {
		startDate: '2026-08-01',
		endDate: '2026-08-10',
		defaultVisibility: 'private'
	});
	makeSegment(t.id, 'flight', 'Out', '2026-08-01T10:00:00Z');
	makeSegment(t.id, 'hotel', 'Stay', '2026-08-01T16:00:00Z');

	const csv = exportTripsCsv(Number(owner.id));
	const lines = csv.trim().split('\n');
	expect(lines).toHaveLength(3); // header + 2 segments
	expect(lines.filter((l) => l.includes('RT'))).toHaveLength(2);
});

test('exportTrips always includes mail holds and CSV stays segment-only', () => {
	const owner = makeUser('mh@x.c');
	const empty = makeTrip(Number(owner.id), 'Empty');
	const held = makeTrip(Number(owner.id), 'Held', { startDate: '2026-08-01', endDate: '2026-08-20' });
	createMailHold({
		tripId: held.id,
		carrier: 'USPS',
		startDate: '2026-08-01',
		endDate: '2026-08-10',
		confirmationNumber: 'HOLDSECRET',
		addressLabel: 'HOMEADDR',
		status: 'requested'
	});

	const exported = exportTrips(Number(owner.id));
	const emptyTrip = exported.find((trip) => trip.name === 'Empty');
	const heldTrip = exported.find((trip) => trip.name === 'Held');
	expect(emptyTrip?.mailHolds).toEqual([]);
	expect(heldTrip?.mailHolds).toEqual([
		{
			carrier: 'USPS',
			startDate: '2026-08-01',
			endDate: '2026-08-10',
			confirmationNumber: 'HOLDSECRET',
			addressLabel: 'HOMEADDR',
			status: 'requested'
		}
	]);
	const json = exportTripsJson(Number(owner.id));
	expect(json).toContain('HOLDSECRET');
	const csv = exportTripsCsv(Number(owner.id));
	expect(csv).not.toContain('HOLDSECRET');
	expect(csv).not.toContain('HOMEADDR');
	expect(empty.id).toBeGreaterThan(0);
});

test('exportTripsCsv quotes fields that contain a carriage return', () => {
	const owner = makeUser('cr@x.c');
	const t = makeTrip(Number(owner.id), 'CR trip', { notes: 'line one\rline two' });
	makeSegment(t.id, 'hotel', 'Suite\r7', '2026-08-01T16:00:00Z');
	const csv = exportTripsCsv(Number(owner.id));
	expect(csv).toContain('"line one\rline two"');
	expect(csv).toContain('"Suite\r7"');
	expect(csv).toContain('\nCR trip,');

	const parsed = parseCsv(csv);
	expect(parsed.trips).toHaveLength(1);
	expect(parsed.trips[0]!.notes).toBe('line one\rline two');
	expect(parsed.trips[0]!.segments).toHaveLength(1);
	expect(parsed.trips[0]!.segments![0]!.title).toBe('Suite\r7');
});

test('exportTripsCsv keeps every line-break form quoted and round-trips it exactly', () => {
	const owner = makeUser('lb@x.c');
	const cases: Array<[string, string]> = [
		['Bare CR', 'a\rb'],
		['CRLF', 'a\r\nb'],
		['LF', 'a\nb']
	];
	for (const [name, notes] of cases) {
		makeTrip(Number(owner.id), name, { notes });
	}
	const csv = exportTripsCsv(Number(owner.id));
	expect(csv).toContain('"a\rb"');
	expect(csv).toContain('"a\r\nb"');
	expect(csv).toContain('"a\nb"');

	const parsed = parseCsv(csv);
	expect(parsed.trips).toHaveLength(3);
	for (const [name, notes] of cases) {
		const trip = parsed.trips.find((t) => t.name === name);
		expect(trip, `trip ${name}`).toBeDefined();
		expect(trip!.notes).toBe(notes);
	}
});
