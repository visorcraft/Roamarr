import { test, expect, vi, beforeEach, afterAll } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

import { eq } from '@visorcraft/mongreldb-kit';
import * as repo from './travelDataRepo';
import { makeKitUser } from '../../../../tests/kitHelpers';
import { createTrip } from './tripsRepo';
import {
	geonamesCities,
	fareProviders,
	fareWatches,
	trips
} from '$lib/server/db/mongrelSchema';

function resetKitTables() {
	ctx.kit.deleteFrom(fareWatches).executeSync();
	ctx.kit.deleteFrom(fareProviders).executeSync();
	ctx.kit.deleteFrom(geonamesCities).executeSync();
	ctx.kit.deleteFrom(trips).executeSync();
}

beforeEach(() => {
	resetKitTables();
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

	const stored = ctx.kit
		.selectFrom(geonamesCities)
		.where(eq(geonamesCities.geoname_id, BigInt(LYON.geonameId)))
		.executeSync()[0];
	expect(stored?.name).toBe('Lyon');
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

test('createFareProvider encrypts the API key', () => {
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

	const stored = ctx.kit
		.selectFrom(fareProviders)
		.where(eq(fareProviders.id, BigInt(p.id)))
		.executeSync()[0];
	expect(stored!.api_key).not.toBe('SECRET');
	expect(Number(stored!.user_id)).toBe(Number(u.id));
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

test('deleteFareProvider removes the row', () => {
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
		ctx.kit.selectFrom(fareProviders).where(eq(fareProviders.id, BigInt(p.id))).executeSync()[0]
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

test('createFareWatch and updateFareWatch persist status', () => {
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

	const stored = ctx.kit
		.selectFrom(fareWatches)
		.where(eq(fareWatches.id, BigInt(watch.id)))
		.executeSync()[0];
	expect(Number(stored!.provider_id)).toBe(provider.id);
	expect(stored!.status).toBe('active');

	const updated = repo.updateFareWatch(watch.id, { status: 'paused' });
	expect(updated?.status).toBe('paused');
	expect(
		ctx.kit.selectFrom(fareWatches).where(eq(fareWatches.id, BigInt(watch.id))).executeSync()[0]!.status
	).toBe('paused');
});

test('deleteFareWatch removes the row', () => {
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
		ctx.kit.selectFrom(fareWatches).where(eq(fareWatches.id, BigInt(watch.id))).executeSync()[0]
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

test('listActiveFareWatches honors an optional limit, oldest-checked first', () => {
	const u = makeKitUser({ email: 'fw-limit@x.c' });
	const trip = createTrip(Number(u.id), { name: 'T' });
	const ids: number[] = [];
	for (let i = 0; i < 5; i++) {
		const provider = repo.createFareProvider({
			userId: Number(u.id),
			providerKey: 'stub',
			label: `P${i}`,
			apiKey: null,
			enabled: true
		});
		const w = repo.createFareWatch({ tripId: trip.id, providerId: provider.id });
		repo.updateFareWatch(w.id, { lastCheckedAt: `2026-01-0${i + 1}T00:00:00Z` });
		ids.push(w.id);
	}
	expect(repo.listActiveFareWatches()).toHaveLength(5);
	const limited = repo.listActiveFareWatches({ limit: 3 });
	expect(limited).toHaveLength(3);
	expect(limited.map((r) => r.id)).toEqual([ids[0], ids[1], ids[2]]);
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
