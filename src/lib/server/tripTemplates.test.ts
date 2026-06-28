import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { createTripFromTemplate, listTripTemplates, saveTripTemplate } from './tripTemplates';
import { auditLogs, segments, trips, users } from './db/schema';
import { users as kitUsers, trips as kitTrips, tripTemplates as kitTripTemplates } from './db/mongrelSchema';
import { eq } from 'drizzle-orm';
import * as usersRepo from './repositories/usersRepo';
import * as tripsRepo from './repositories/tripsRepo';

beforeEach(() => {
	const db = (ctx as { db: import('./db').DB }).db;
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	db.delete(auditLogs).run();
	db.delete(segments).run();
	db.delete(trips).run();
	db.delete(users).run();
	kit.deleteFrom(kitTripTemplates).executeSync();
	kit.deleteFrom(kitTrips).executeSync();
	kit.deleteFrom(kitUsers).executeSync();
});

function seed() {
	const u = usersRepo.createUser({
		email: 'tpl@x.c',
		password_hash: 'x',
		display_name: 'U',
		calendar_token: null,
		calendar_token_expires_at: null
	});
	const t = tripsRepo.createTrip(Number(u.id), {
		name: 'Source',
		destinationCountryCode: 'FR',
		destinationCityName: 'Paris',
		destinationCityLat: 48.8566,
		destinationCityLng: 2.3522
	});
	return { db: (ctx as { db: import('./db').DB }).db, u, t };
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

	const tpl = saveTripTemplate(Number(u.id), t.id, 'Paris template');
	expect(tpl.name).toBe('Paris template');
	expect(tpl.userId).toBe(Number(u.id));
	expect(JSON.stringify(tpl.snapshot)).toContain('UA1');

	const logs = db.select().from(auditLogs).where(eq(auditLogs.entityId, tpl.id)).all();
	expect(logs.map((l: Record<string, unknown>) => l.action)).toContain('create');
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

	const tpl = saveTripTemplate(Number(u.id), t.id, 'Copy');
	const copy = createTripFromTemplate(Number(u.id), tpl.id, {
		name: 'Copied trip',
		startDate: '2027-01-01',
		endDate: '2027-01-07'
	});

	expect(copy.name).toBe('Copied trip');
	expect(copy.destination).toBeNull();
	expect(copy.destinationCityName).toBe('Paris');
	expect(copy.destinationCountryCode).toBe('FR');
	expect(copy.startDate).toBe('2027-01-01');

	const segs = db.select().from(segments).where(eq(segments.tripId, copy.id)).all();
	expect(segs).toHaveLength(1);
	expect(segs[0].title).toBe('Hilton');
});

test('listTripTemplates returns only the users templates', () => {
	const { u, t } = seed();
	const other = usersRepo.createUser({
		email: 'oth@x.c',
		password_hash: 'x',
		display_name: 'O',
		calendar_token: null,
		calendar_token_expires_at: null
	});
	const otherTrip = tripsRepo.createTrip(Number(other.id), { name: 'Other' });

	saveTripTemplate(Number(u.id), t.id, 'Mine');
	saveTripTemplate(Number(other.id), otherTrip.id, 'Theirs');

	expect(listTripTemplates(Number(u.id)).map((tpl) => tpl.name)).toEqual(['Mine']);
});

test('saveTripTemplate rejects non-owner', () => {
	const { u, t } = seed();
	const other = usersRepo.createUser({
		email: 'no@x.c',
		password_hash: 'x',
		display_name: 'O',
		calendar_token: null,
		calendar_token_expires_at: null
	});
	expect(() => saveTripTemplate(Number(other.id), t.id, 'Nope')).toThrow();
});

test('createTripFromTemplate rejects foreign template', () => {
	const { u, t } = seed();
	const tpl = saveTripTemplate(Number(u.id), t.id, 'Mine');
	const other = usersRepo.createUser({
		email: 'no2@x.c',
		password_hash: 'x',
		display_name: 'O',
		calendar_token: null,
		calendar_token_expires_at: null
	});
	expect(() => createTripFromTemplate(Number(other.id), tpl.id, {})).toThrow();
});
