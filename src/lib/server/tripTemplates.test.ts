import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { createTripFromTemplate, listTripTemplates, saveTripTemplate } from './tripTemplates';
import { auditLogs, segments, trips, users, tripTemplates } from './db/mongrelSchema';
import { eq, type KitDatabase } from '@mongreldb/kit';
import * as usersRepo from './repositories/usersRepo';
import * as tripsRepo from './repositories/tripsRepo';

function getKit(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

beforeEach(() => {
	const kit = getKit();
	kit.deleteFrom(auditLogs).executeSync();
	kit.deleteFrom(tripTemplates).executeSync();
	kit.deleteFrom(segments).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
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
	return { kit: getKit(), u, t };
}

test('saveTripTemplate snapshots trip segments and tags', () => {
	const { kit, u, t } = seed();
	kit
		.insertInto(segments)
		.values({
			trip_id: BigInt(t.id),
			type: 'flight',
			title: 'UA1',
			start_at: '2026-08-01T10:00:00Z',
			start_tz: 'UTC',
			location: 'CDG'
		} as never)
		.executeSync();

	const tpl = saveTripTemplate(Number(u.id), t.id, 'Paris template');
	expect(tpl.name).toBe('Paris template');
	expect(tpl.userId).toBe(Number(u.id));
	expect(JSON.stringify(tpl.snapshot)).toContain('UA1');

	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.entity_id, BigInt(tpl.id))).executeSync();
	expect(logs.map((l) => l.action)).toContain('create');
});

test('createTripFromTemplate copies segments and metadata', () => {
	const { kit, u, t } = seed();
	kit
		.insertInto(segments)
		.values({
			trip_id: BigInt(t.id),
			type: 'hotel',
			title: 'Hilton',
			start_at: '2026-08-01T15:00:00Z',
			start_tz: 'UTC'
		} as never)
		.executeSync();

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

	const segs = kit.selectFrom(segments).where(eq(segments.trip_id, BigInt(copy.id))).executeSync();
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
