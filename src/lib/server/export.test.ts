import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { exportTrips, exportTripsJson, exportTripsCsv } from './export';
import { users, trips, segments } from './db/schema';
import { users as kitUsers, trips as kitTrips, segments as kitSegments } from './db/mongrelSchema';
import * as usersRepo from './repositories/usersRepo';
import * as tripsRepo from './repositories/tripsRepo';
import * as segmentsRepo from './repositories/segmentsRepo';

beforeEach(() => {
	const db = (ctx as { db: import('./db').DB }).db;
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	db.delete(segments).run();
	db.delete(trips).run();
	db.delete(users).run();
	kit.deleteFrom(kitSegments).executeSync();
	kit.deleteFrom(kitTrips).executeSync();
	kit.deleteFrom(kitUsers).executeSync();
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
