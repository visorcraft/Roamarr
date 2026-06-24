import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { exportTrips, exportTripsJson, exportTripsCsv } from './export';
import { users, trips, segments } from './db/schema';
import { beforeEach } from 'vitest';

beforeEach(() => {
	(ctx as any).sqlite.exec('delete from segments;');
	(ctx as any).sqlite.exec('delete from trips;');
	(ctx as any).sqlite.exec('delete from users;');
});

test('exportTrips returns only owned trips with segments', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const owner = db.insert(users).values({ email: 'o@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const other = db.insert(users).values({ email: 'x@x.c', passwordHash: 'x', displayName: 'X' }).returning().get();
	const t1 = db
		.insert(trips)
		.values({ ownerId: owner.id, name: 'Mine', destination: 'Paris', startDate: '2026-07-01', tags: '["work"]' })
		.returning()
		.get();
	db.insert(segments)
		.values({ tripId: t1.id, type: 'flight', title: 'AF1', startAt: '2026-07-01T08:00:00Z', startTz: 'Europe/Paris' })
		.run();
	db.insert(trips).values({ ownerId: other.id, name: 'Not mine' }).run();

	const exported = exportTrips(owner.id);
	expect(exported).toHaveLength(1);
	expect(exported[0].name).toBe('Mine');
	expect(exported[0].tags).toEqual(['work']);
	expect(exported[0].segments).toHaveLength(1);
	expect(exported[0].segments![0].title).toBe('AF1');
});

test('exportTripsJson returns parseable JSON', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const owner = db.insert(users).values({ email: 'j@x.c', passwordHash: 'x', displayName: 'J' }).returning().get();
	db.insert(trips).values({ ownerId: owner.id, name: 'JSON trip' }).run();
	const json = exportTripsJson(owner.id);
	const parsed = JSON.parse(json);
	expect(parsed.trips).toHaveLength(1);
	expect(parsed.trips[0].name).toBe('JSON trip');
});

test('exportTripsCsv includes header and trip row', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const owner = db.insert(users).values({ email: 'c@x.c', passwordHash: 'x', displayName: 'C' }).returning().get();
	db.insert(trips).values({ ownerId: owner.id, name: 'CSV trip', startDate: '2026-08-01' }).run();
	const csv = exportTripsCsv(owner.id);
	const lines = csv.trim().split('\n');
	expect(lines[0]).toContain('name');
	expect(lines[1]).toContain('CSV trip');
});
