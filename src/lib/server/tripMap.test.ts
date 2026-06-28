import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { selectNextSegmentCity, tripMapCity } from './tripMap';
import { users, trips, segments } from './db/mongrelSchema';
import { eq, type KitDatabase } from '@mongreldb/kit';

let fixtureCounter = 0;

function getKit(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function insertSegments(kit: KitDatabase, rows: Record<string, unknown>[]) {
	for (const row of rows) {
		kit.insertInto(segments).values(row as never).executeSync();
	}
}

function insertFixtures() {
	const kit = getKit();
	const n = fixtureCounter++;
	const u = kit
		.insertInto(users)
		.values({ email: `map-${n}@x.c`, password_hash: 'x', display_name: 'M' } as never)
		.executeSync();
	const t = kit.insertInto(trips).values({ owner_id: u.id, name: 'T' } as never).executeSync();
	return { kit, t: { ...t, id: Number(t.id) } };
}

test('selects the first upcoming segment with coordinates', () => {
	const { kit, t } = insertFixtures();
	insertSegments(kit, [
		{ trip_id: BigInt(t.id), type: 'hotel', title: 'Past', start_at: '2020-01-01T10:00:00Z', start_tz: 'UTC', country_code: 'FR', city_name: 'Paris', city_lat: 48.85, city_lng: 2.35 },
		{ trip_id: BigInt(t.id), type: 'hotel', title: 'Next', start_at: '2099-01-01T10:00:00Z', start_tz: 'UTC', country_code: 'JP', city_name: 'Tokyo', city_lat: 35.68, city_lng: 139.76 },
		{ trip_id: BigInt(t.id), type: 'hotel', title: 'Later', start_at: '2099-02-01T10:00:00Z', start_tz: 'UTC', country_code: 'US', city_name: 'New York', city_lat: 40.71, city_lng: -74 }
	]);

	const next = selectNextSegmentCity(t.id);
	expect(next?.cityName).toBe('Tokyo');
});

test('respects local timezone when comparing to now', () => {
	const { kit, t } = insertFixtures();
	insertSegments(kit, [
		{ trip_id: BigInt(t.id), type: 'food', title: 'Late night Tokyo', start_at: '2099-01-01T02:00:00+09:00', start_tz: 'Asia/Tokyo', country_code: 'JP', city_name: 'Tokyo', city_lat: 35.68, city_lng: 139.76 }
	]);

	const next = selectNextSegmentCity(t.id);
	expect(next?.cityName).toBe('Tokyo');
});

test('returns null when no upcoming segment has coordinates', () => {
	const { kit, t } = insertFixtures();
	insertSegments(kit, [
		{ trip_id: BigInt(t.id), type: 'note', title: 'No coords', start_at: '2099-01-01T10:00:00Z', start_tz: 'UTC' }
	]);
	expect(selectNextSegmentCity(t.id)).toBeNull();
});

test('tripMapCity prefers the next segment city', () => {
	const { kit, t } = insertFixtures();
	kit.updateTable(trips)
		.set({ destination_city_name: 'Tokyo', destination_country_code: 'JP', destination_city_lat: 35.68, destination_city_lng: 139.76 } as never)
		.where(eq(trips.id, BigInt(t.id)))
		.executeSync();
	insertSegments(kit, [
		{ trip_id: BigInt(t.id), type: 'hotel', title: 'Next', start_at: '2099-01-01T10:00:00Z', start_tz: 'UTC', country_code: 'FR', city_name: 'Paris', city_lat: 48.85, city_lng: 2.35 }
	]);
	const city = tripMapCity(t.id);
	expect(city?.cityName).toBe('Paris');
	expect(city?.segmentId).not.toBeNull();
});

test('tripMapCity falls back to the destination city when no segment has one', () => {
	const { kit, t } = insertFixtures();
	kit.updateTable(trips)
		.set({ destination_city_name: 'Tokyo', destination_country_code: 'JP', destination_city_lat: 35.68, destination_city_lng: 139.76 } as never)
		.where(eq(trips.id, BigInt(t.id)))
		.executeSync();
	insertSegments(kit, [
		{ trip_id: BigInt(t.id), type: 'note', title: 'No coords', start_at: '2099-01-01T10:00:00Z', start_tz: 'UTC' }
	]);
	const city = tripMapCity(t.id);
	expect(city).toMatchObject({ cityName: 'Tokyo', countryCode: 'JP', lat: 35.68, lng: 139.76, segmentId: null });
});

test('tripMapCity returns null when neither a segment nor a destination has coordinates', () => {
	const { t } = insertFixtures();
	expect(tripMapCity(t.id)).toBeNull();
});
