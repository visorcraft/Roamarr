import { test, expect, vi, beforeEach, afterAll } from 'vitest';

const ctx = vi.hoisted(() => ({
	db: null as unknown as import('$lib/server/db').DB,
	sqlite: null as unknown as import('better-sqlite3').Database,
	kit: null as unknown as import('@mongreldb/kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	const { db, sqlite, kit, close } = freshDb();
	Object.assign(ctx, { db, sqlite, kit, close });
	return { db, sqlite, kit, getDb: () => kit };
});

import * as repo from './travelDataRepo';
import { makeKitUser } from '../../../../tests/kitHelpers';
import { createTrip } from './tripsRepo';
import {
	geonamesCities,
	fareProviders,
	fareWatches,
	trips
} from '$lib/server/db/mongrelSchema';
import {
	geonamesCities as drizzleGeonamesCities,
	fareProviders as drizzleFareProviders,
	fareWatches as drizzleFareWatches
} from '$lib/server/db/schema';
import { eq as kitEq } from '@mongreldb/kit';
import { eq } from 'drizzle-orm';

function resetKitTables() {
	ctx.kit.deleteFrom(fareWatches).executeSync();
	ctx.kit.deleteFrom(fareProviders).executeSync();
	ctx.kit.deleteFrom(geonamesCities).executeSync();
	ctx.kit.deleteFrom(trips).executeSync();
	// users are reset via legacy below; keep kit users in sync by rebuilding them per test.
}

function resetLegacyTables() {
	ctx.sqlite.exec(
		'delete from fare_watches; delete from fare_providers; delete from geonames_cities; delete from segments; delete from trips; delete from users;'
	);
}

beforeEach(() => {
	resetKitTables();
	resetLegacyTables();
});

afterAll(() => {
	ctx.close();
});

const PARIS: repo.GeonamesCityRow = {
	geonameId: 2988507,
	name: 'Paris',
	asciiName: 'Paris',
	countryCode: 'FR',
	lat: 48.8534,
	lng: 2.3488,
	population: 2161000,
	timezone: 'Europe/Paris'
};

const LYON: repo.GeonamesCityRow = {
	geonameId: 2996944,
	name: 'Lyon',
	asciiName: 'Lyon',
	countryCode: 'FR',
	lat: 45.76,
	lng: 4.83,
	population: 500000,
	timezone: 'Europe/Paris'
};

const BERLIN: repo.GeonamesCityRow = {
	geonameId: 2950159,
	name: 'Berlin',
	asciiName: 'Berlin',
	countryCode: 'DE',
	lat: 52.52,
	lng: 13.4,
	population: 3500000,
	timezone: 'Europe/Berlin'
};

// GeoNames

test('importCitiesBatch clears existing data and inserts rows', () => {
	repo.importCitiesBatch([PARIS]);
	repo.importCitiesBatch([LYON]);

	expect(repo.countCities()).toBe(1);
	expect(repo.getCityByGeoNameId(LYON.geonameId)?.name).toBe('Lyon');
	expect(repo.getCityByGeoNameId(PARIS.geonameId)).toBeNull();

	const legacy = ctx.db
		.select()
		.from(drizzleGeonamesCities)
		.where(eq(drizzleGeonamesCities.geonameId, LYON.geonameId))
		.get();
	expect(legacy?.name).toBe('Lyon');
});

test('searchCities filters by country and query', () => {
	repo.importCitiesBatch([PARIS, LYON, BERLIN]);

	const fr = repo.searchCities('Par', 'FR');
	expect(fr.map((c) => c.name)).toEqual(['Paris']);

	const de = repo.searchCities('Ber', 'DE');
	expect(de.map((c) => c.name)).toEqual(['Berlin']);

	expect(repo.searchCities('Lon', 'FR')).toHaveLength(0);
});

test('searchCities without country code searches globally', () => {
	repo.importCitiesBatch([PARIS, BERLIN]);
	const results = repo.searchCities('Par');
	expect(results.some((c) => c.name === 'Paris')).toBe(true);
});

test('findCityByCountryAndName returns the matching city', () => {
	repo.importCitiesBatch([PARIS, BERLIN]);
	const city = repo.findCityByCountryAndName('FR', 'Paris');
	expect(city?.geonameId).toBe(PARIS.geonameId);
});

test('listCitiesByCountry orders by population descending', () => {
	repo.importCitiesBatch([PARIS, LYON]);
	const cities = repo.listCitiesByCountry('FR');
	expect(cities.map((c) => c.name)).toEqual(['Paris', 'Lyon']);
});

test('listTopCitiesByPopulation returns global top cities', () => {
	repo.importCitiesBatch([PARIS, LYON, BERLIN]);
	const cities = repo.listTopCitiesByPopulation(2);
	expect(cities).toHaveLength(2);
	expect(cities[0].geonameId).toBe(BERLIN.geonameId);
});

// Fare providers

test('createFareProvider encrypts the API key and mirrors to legacy', () => {
	const u = makeKitUser({ email: 'fp@x.c' });
	const p = repo.createFareProvider({
		userId: Number(u.id),
		providerKey: 'stub',
		label: 'Work',
		apiKey: 'SECRET',
		enabled: true
	});

	expect(p.label).toBe('Work');
	expect(p.apiKey).toBe('SECRET');

	const kitRow = ctx.kit
		.selectFrom(fareProviders)
		.where(kitEq(fareProviders.id, BigInt(p.id)))
		.executeSync()[0];
	expect(kitRow!.api_key).not.toBe('SECRET');

	const legacy = ctx.db
		.select()
		.from(drizzleFareProviders)
		.where(eq(drizzleFareProviders.id, p.id))
		.get()!;
	expect(legacy.apiKey).not.toBe('SECRET');
	expect(legacy.userId).toBe(Number(u.id));
});

test('updateFareProvider preserves the API key when given an empty string', () => {
	const u = makeKitUser({ email: 'fp-up@x.c' });
	const p = repo.createFareProvider({
		userId: Number(u.id),
		providerKey: 'stub',
		label: 'Original',
		apiKey: 'ORIGINAL-KEY',
		enabled: true
	});

	const updated = repo.updateFareProvider(p.id, { label: 'Renamed', apiKey: '', enabled: false });
	expect(updated?.label).toBe('Renamed');
	expect(updated?.enabled).toBe(false);
	expect(updated?.apiKey).toBe('ORIGINAL-KEY');
});

test('deleteFareProvider removes the row from kit and legacy', () => {
	const u = makeKitUser({ email: 'fp-del@x.c' });
	const p = repo.createFareProvider({
		userId: Number(u.id),
		providerKey: 'stub',
		label: 'X',
		apiKey: null,
		enabled: true
	});

	expect(repo.deleteFareProvider(p.id)).toBe(true);
	expect(repo.getFareProviderById(p.id)).toBeNull();
	expect(
		ctx.db.select().from(drizzleFareProviders).where(eq(drizzleFareProviders.id, p.id)).get()
	).toBeUndefined();
});

test('listFareProvidersForUser returns only owned providers', () => {
	const a = makeKitUser({ email: 'fp-a@x.c' });
	const b = makeKitUser({ email: 'fp-b@x.c' });
	repo.createFareProvider({
		userId: Number(a.id),
		providerKey: 'stub',
		label: 'A',
		apiKey: null,
		enabled: true
	});
	repo.createFareProvider({
		userId: Number(b.id),
		providerKey: 'stub',
		label: 'B',
		apiKey: null,
		enabled: true
	});

	const listed = repo.listFareProvidersForUser(Number(a.id));
	expect(listed).toHaveLength(1);
	expect(listed[0].label).toBe('A');
});

// Fare watches

test('createFareWatch and updateFareWatch mirror to legacy', () => {
	const u = makeKitUser({ email: 'fw@x.c' });
	const trip = createTrip(Number(u.id), { name: 'T' });
	const provider = repo.createFareProvider({
		userId: Number(u.id),
		providerKey: 'stub',
		label: 'P',
		apiKey: null,
		enabled: true
	});

	const watch = repo.createFareWatch({ tripId: trip.id, providerId: provider.id });
	expect(watch.status).toBe('active');
	expect(watch.tripId).toBe(trip.id);

	const legacy = ctx.db
		.select()
		.from(drizzleFareWatches)
		.where(eq(drizzleFareWatches.id, watch.id))
		.get()!;
	expect(legacy.providerId).toBe(provider.id);
	expect(legacy.status).toBe('active');

	const updated = repo.updateFareWatch(watch.id, { status: 'paused' });
	expect(updated?.status).toBe('paused');
	expect(
		ctx.db.select().from(drizzleFareWatches).where(eq(drizzleFareWatches.id, watch.id)).get()!.status
	).toBe('paused');
});

test('touchFareWatch updates lastCheckedAt', () => {
	const u = makeKitUser({ email: 'fw-touch@x.c' });
	const trip = createTrip(Number(u.id), { name: 'T' });
	const provider = repo.createFareProvider({
		userId: Number(u.id),
		providerKey: 'stub',
		label: 'P',
		apiKey: null,
		enabled: true
	});
	const watch = repo.createFareWatch({ tripId: trip.id, providerId: provider.id });

	const touched = repo.touchFareWatch(watch.id);
	expect(touched?.lastCheckedAt).not.toBeNull();
});

test('deleteFareWatch removes the row from kit and legacy', () => {
	const u = makeKitUser({ email: 'fw-del@x.c' });
	const trip = createTrip(Number(u.id), { name: 'T' });
	const provider = repo.createFareProvider({
		userId: Number(u.id),
		providerKey: 'stub',
		label: 'P',
		apiKey: null,
		enabled: true
	});
	const watch = repo.createFareWatch({ tripId: trip.id, providerId: provider.id });

	expect(repo.deleteFareWatch(watch.id)).toBe(true);
	expect(repo.getFareWatchById(watch.id)).toBeNull();
	expect(
		ctx.db.select().from(drizzleFareWatches).where(eq(drizzleFareWatches.id, watch.id)).get()
	).toBeUndefined();
});

test('listActiveFareWatches returns only active watches with enabled providers', () => {
	const u = makeKitUser({ email: 'fw-active@x.c' });
	const trip = createTrip(Number(u.id), { name: 'T' });
	const activeProvider = repo.createFareProvider({
		userId: Number(u.id),
		providerKey: 'stub',
		label: 'Active',
		apiKey: null,
		enabled: true
	});
	const disabledProvider = repo.createFareProvider({
		userId: Number(u.id),
		providerKey: 'stub',
		label: 'Disabled',
		apiKey: null,
		enabled: false
	});

	repo.createFareWatch({ tripId: trip.id, providerId: activeProvider.id });
	repo.createFareWatch({ tripId: trip.id, providerId: disabledProvider.id });

	const rows = repo.listActiveFareWatches();
	expect(rows).toHaveLength(1);
	expect(rows[0].provider.id).toBe(activeProvider.id);
});

test('getFareWatchByTripAndProvider is idempotent', () => {
	const u = makeKitUser({ email: 'fw-idem@x.c' });
	const trip = createTrip(Number(u.id), { name: 'T' });
	const provider = repo.createFareProvider({
		userId: Number(u.id),
		providerKey: 'stub',
		label: 'P',
		apiKey: null,
		enabled: true
	});

	const w1 = repo.createFareWatch({ tripId: trip.id, providerId: provider.id });
	const w2 = repo.getFareWatchByTripAndProvider(trip.id, provider.id);
	expect(w2?.id).toBe(w1.id);
});
