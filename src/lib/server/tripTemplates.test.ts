import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { createTripFromTemplate, listTripTemplates, saveTripTemplate } from './tripTemplates';
import { auditLogs, segments, trips, tripTemplates, users } from './db/schema';
import { eq } from 'drizzle-orm';

beforeEach(() => {
	(ctx as { sqlite: import('better-sqlite3').Database }).sqlite.exec(
		'delete from trip_templates; delete from audit_logs; delete from segments; delete from trips; delete from users;'
	);
});

function seed() {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'tpl@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'Source', destination: 'Paris' }).returning().get();
	return { db, u, t };
}

test('saveTripTemplate snapshots trip segments and tags', () => {
	const { db, u, t } = seed();
	db.insert(segments)
		.values({
			tripId: t.id,
			type: 'flight',
			title: 'UA1',
			startAt: '2026-08-01T10:00:00Z',
			startTz: 'UTC',
			location: 'CDG'
		})
		.run();

	const tpl = saveTripTemplate(u.id, t.id, 'Paris template');
	expect(tpl.name).toBe('Paris template');
	expect(tpl.userId).toBe(u.id);
	expect(tpl.snapshotJson).toContain('UA1');

	const logs = db.select().from(auditLogs).where(eq(auditLogs.entityId, tpl.id)).all();
	expect(logs.map((l) => l.action)).toContain('create');
});

test('createTripFromTemplate copies segments and metadata', () => {
	const { db, u, t } = seed();
	db.insert(segments)
		.values({
			tripId: t.id,
			type: 'hotel',
			title: 'Hilton',
			startAt: '2026-08-01T15:00:00Z',
			startTz: 'UTC'
		})
		.run();

	const tpl = saveTripTemplate(u.id, t.id, 'Copy');
	const copy = createTripFromTemplate(u.id, tpl.id, {
		name: 'Copied trip',
		startDate: '2027-01-01',
		endDate: '2027-01-07'
	});

	expect(copy.name).toBe('Copied trip');
	expect(copy.destination).toBe('Paris');
	expect(copy.startDate).toBe('2027-01-01');

	const segs = db.select().from(segments).where(eq(segments.tripId, copy.id)).all();
	expect(segs).toHaveLength(1);
	expect(segs[0].title).toBe('Hilton');
});

test('listTripTemplates returns only the users templates', () => {
	const { db, u, t } = seed();
	const other = db.insert(users).values({ email: 'oth@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const otherTrip = db.insert(trips).values({ ownerId: other.id, name: 'Other' }).returning().get();

	saveTripTemplate(u.id, t.id, 'Mine');
	saveTripTemplate(other.id, otherTrip.id, 'Theirs');

	expect(listTripTemplates(u.id).map((tpl) => tpl.name)).toEqual(['Mine']);
});

test('saveTripTemplate rejects non-owner', () => {
	const { db, u, t } = seed();
	const other = db.insert(users).values({ email: 'no@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	expect(() => saveTripTemplate(other.id, t.id, 'Nope')).toThrow();
});

test('createTripFromTemplate rejects foreign template', () => {
	const { u, t } = seed();
	const tpl = saveTripTemplate(u.id, t.id, 'Mine');
	const other = (ctx as { db: import('./db').DB }).db
		.insert(users)
		.values({ email: 'no2@x.c', passwordHash: 'x', displayName: 'O' })
		.returning()
		.get();
	expect(() => createTripFromTemplate(other.id, tpl.id, {})).toThrow();
});
