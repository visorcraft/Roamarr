import { test, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { parseJson, parseCsv, importTrips } from './import';
import { users, trips, segments, reminders, auditLogs } from './db/schema';

beforeEach(() => {
	(ctx as { sqlite: import('better-sqlite3').Database }).sqlite.exec(
		'delete from reminders; delete from segments; delete from trips; delete from users; delete from audit_logs;'
	);
});

function makeUser(email = 'u@x.c') {
	const db = (ctx as { db: import('./db').DB }).db;
	return db.insert(users).values({ email, passwordHash: 'x', displayName: 'U' }).returning().get();
}

test('parseJson accepts a trips array', () => {
	const input = JSON.stringify({
		trips: [{ name: 'Tokyo', startDate: '2026-08-01', segments: [{ type: 'flight', title: 'Out', localStart: '2026-08-01T10:00', startTz: 'UTC' }] }]
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
	const csv = 'name,destination,startDate,endDate,segmentType,segmentTitle,segmentLocalStart,segmentStartTz\nTokyo,Japan,2026-08-01,2026-08-10,flight,Out,2026-08-01T10:00,UTC';
	const parsed = parseCsv(csv);
	expect(parsed.trips).toHaveLength(1);
	expect(parsed.trips[0]!.name).toBe('Tokyo');
	expect(parsed.trips[0]!.segments).toHaveLength(1);
	expect(parsed.trips[0]!.segments![0]!.type).toBe('flight');
});

test('parseCsv handles commas inside quoted values', () => {
	const csv = 'name,destination\n"Summer, Escape","Lisbon, Portugal"';
	const parsed = parseCsv(csv);
	expect(parsed.trips[0]!.name).toBe('Summer, Escape');
	expect(parsed.trips[0]!.destination).toBe('Lisbon, Portugal');
});

test('importTrips creates trips and segments', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = makeUser();
	const result = importTrips(u.id, {
		trips: [
			{
				name: 'Tokyo',
				destination: 'Japan',
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
	const t = db.select().from(trips).where(eq(trips.ownerId, u.id)).get();
	expect(t).toBeDefined();
	expect(t!.name).toBe('Tokyo');
	const s = db.select().from(segments).where(eq(segments.tripId, t!.id)).get();
	expect(s).toBeDefined();
	expect(s!.type).toBe('flight');
	expect(db.select().from(reminders).all()).toHaveLength(1);
	expect(db.select().from(auditLogs).all()).toHaveLength(1);
});

test('importTrips mints public token for public visibility', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = makeUser();
	importTrips(u.id, {
		trips: [{ name: 'Public Trip', defaultVisibility: 'public' }]
	});
	const t = db.select().from(trips).where(eq(trips.ownerId, u.id)).get();
	expect(t!.publicToken).toBeTruthy();
});

test('importTrips collects validation errors without creating invalid trips', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = makeUser();
	const result = importTrips(u.id, {
		trips: [
			{ name: '', startDate: 'bad', endDate: '2026-01-01' },
			{ name: 'Good', startDate: '2026-08-01', endDate: '2026-08-10' }
		]
	});
	expect(result.imported).toBe(1);
	expect(result.errors.length).toBeGreaterThan(0);
	expect(db.select().from(trips).where(eq(trips.ownerId, u.id)).all()).toHaveLength(1);
});

test('importTrips skips invalid segments but keeps the trip', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = makeUser();
	const result = importTrips(u.id, {
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
	const t = db.select().from(trips).where(eq(trips.ownerId, u.id)).get();
	expect(db.select().from(segments).where(eq(segments.tripId, t!.id)).all()).toHaveLength(1);
});
