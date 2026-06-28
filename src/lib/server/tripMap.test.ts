import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { selectNextSegmentCity, tripMapCity } from './tripMap';
import { users, trips, segments } from './db/mongrelSchema';
import { eq } from '@mongreldb/kit';

let fixtureCounter = 0;

function insertFixtures() {
	const db = (ctx as { db: import('./db').DB }).db;
	const n = fixtureCounter++;
	const u = db.insert(users).values({ email: `map-${n}@x.c`, passwordHash: 'x', displayName: 'M' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	return { db, u, t };
}

test('selects the first upcoming segment with coordinates', () => {
	const { db, t } = insertFixtures();
	db.insert(segments).values([
		{ tripId: t.id, type: 'hotel', title: 'Past', startAt: '2020-01-01T10:00:00Z', startTz: 'UTC', countryCode: 'FR', cityName: 'Paris', cityLat: 48.85, cityLng: 2.35 },
		{ tripId: t.id, type: 'hotel', title: 'Next', startAt: '2099-01-01T10:00:00Z', startTz: 'UTC', countryCode: 'JP', cityName: 'Tokyo', cityLat: 35.68, cityLng: 139.76 },
		{ tripId: t.id, type: 'hotel', title: 'Later', startAt: '2099-02-01T10:00:00Z', startTz: 'UTC', countryCode: 'US', cityName: 'New York', cityLat: 40.71, cityLng: -74 }
	]).run();

	const next = selectNextSegmentCity(t.id);
	expect(next?.cityName).toBe('Tokyo');
});

test('respects local timezone when comparing to now', () => {
	const { db, t } = insertFixtures();
	db.insert(segments).values([
		{ tripId: t.id, type: 'food', title: 'Late night Tokyo', startAt: '2099-01-01T02:00:00+09:00', startTz: 'Asia/Tokyo', countryCode: 'JP', cityName: 'Tokyo', cityLat: 35.68, cityLng: 139.76 }
	]).run();

	const next = selectNextSegmentCity(t.id);
	expect(next?.cityName).toBe('Tokyo');
});

test('returns null when no upcoming segment has coordinates', () => {
	const { db, t } = insertFixtures();
	db.insert(segments).values([
		{ tripId: t.id, type: 'note', title: 'No coords', startAt: '2099-01-01T10:00:00Z', startTz: 'UTC' }
	]).run();
	expect(selectNextSegmentCity(t.id)).toBeNull();
});

test('tripMapCity prefers the next segment city', () => {
	const { db, t } = insertFixtures();
	db.update(trips)
		.set({ destinationCityName: 'Tokyo', destinationCountryCode: 'JP', destinationCityLat: 35.68, destinationCityLng: 139.76 })
		.where(eq(trips.id, BigInt(t.id)))
		.run();
	db.insert(segments).values([
		{ tripId: t.id, type: 'hotel', title: 'Next', startAt: '2099-01-01T10:00:00Z', startTz: 'UTC', countryCode: 'FR', cityName: 'Paris', cityLat: 48.85, cityLng: 2.35 }
	]).run();
	const city = tripMapCity(t.id);
	expect(city?.cityName).toBe('Paris');
	expect(city?.segmentId).not.toBeNull();
});

test('tripMapCity falls back to the destination city when no segment has one', () => {
	const { db, t } = insertFixtures();
	db.update(trips)
		.set({ destinationCityName: 'Tokyo', destinationCountryCode: 'JP', destinationCityLat: 35.68, destinationCityLng: 139.76 })
		.where(eq(trips.id, BigInt(t.id)))
		.run();
	db.insert(segments).values([
		{ tripId: t.id, type: 'note', title: 'No coords', startAt: '2099-01-01T10:00:00Z', startTz: 'UTC' }
	]).run();
	const city = tripMapCity(t.id);
	expect(city).toMatchObject({ cityName: 'Tokyo', countryCode: 'JP', lat: 35.68, lng: 139.76, segmentId: null });
});

test('tripMapCity returns null when neither a segment nor a destination has coordinates', () => {
	const { t } = insertFixtures();
	expect(tripMapCity(t.id)).toBeNull();
});
