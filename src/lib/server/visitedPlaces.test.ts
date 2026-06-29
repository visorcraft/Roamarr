import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { KitDatabase } from '@mongreldb/kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { visitedCountries, visitedUsStates, trips, segments } from './db/mongrelSchema';
import {
	listVisited,
	markCountryVisited,
	markStateVisited,
	unmarkCountryVisited,
	unmarkStateVisited,
	clearVisited,
	autoMarkFromTrip,
	autoMarkFromAllTrips,
	countryVisitSummaries
} from './visitedPlaces';
import { makeUser, makeTrip, makeSegment } from '../../../tests/helpers';

describe('visitedPlaces', () => {
	let userId: number;

	beforeEach(() => {
		ctx.kit.deleteFrom(visitedCountries).executeSync();
		ctx.kit.deleteFrom(visitedUsStates).executeSync();
		ctx.kit.deleteFrom(segments).executeSync();
		ctx.kit.deleteFrom(trips).executeSync();
		const u = makeUser(ctx.kit);
		userId = u.id;
	});

	test('mark and list countries; idempotent; source recorded', () => {
		const r1 = markCountryVisited(userId, 'jp', { visitedOn: '2024-05-01' });
		expect(r1.created).toBe(true);
		const r2 = markCountryVisited(userId, 'JP');
		expect(r2.created).toBe(false);
		const { countries } = listVisited(userId);
		expect(countries.map((c) => c.code)).toEqual(['JP']);
		expect(countries[0].visitedOn).toBe('2024-05-01');
		expect(countries[0].source).toBe('manual');
	});

	test('mark and list US states', () => {
		expect(markStateVisited(userId, 'ca').created).toBe(true);
		expect(markStateVisited(userId, 'ny').created).toBe(true);
		const { usStates } = listVisited(userId);
		expect(usStates.map((s) => s.code).sort()).toEqual(['CA', 'NY']);
	});

	test('rejects unknown country / state codes', () => {
		expect(() => markCountryVisited(userId, 'ZZ')).toThrow();
		expect(() => markStateVisited(userId, 'ZZ')).toThrow();
	});

	test('unmark removes only the requested entry', () => {
		markCountryVisited(userId, 'fr');
		markCountryVisited(userId, 'de');
		expect(unmarkCountryVisited(userId, 'fr').removed).toBe(true);
		expect(unmarkCountryVisited(userId, 'fr').removed).toBe(false);
		expect(listVisited(userId).countries.map((c) => c.code)).toEqual(['DE']);
		expect(unmarkStateVisited(userId, 'tx').removed).toBe(false);
	});

	test('clear removes all of a kind but not the other', () => {
		markCountryVisited(userId, 'fr');
		markCountryVisited(userId, 'de');
		markStateVisited(userId, 'tx');
		expect(clearVisited(userId, 'country')).toBe(2);
		expect(listVisited(userId).countries).toHaveLength(0);
		expect(listVisited(userId).usStates.map((s) => s.code)).toEqual(['TX']);
	});

	test('autoMarkFromTrip marks past segment countries once (idempotent)', () => {
		const t = makeTrip(ctx.kit, userId, { destinationCountryCode: 'FR', status: 'active' });
		makeSegment(ctx.kit, t.id, {
			countryCode: 'DE',
			startAt: '2020-01-01T00:00:00.000Z'
		});
		const added = autoMarkFromTrip(userId, t.id);
		expect(added.countries.sort()).toEqual(['DE', 'FR']);
		expect(added.states).toEqual([]);
		const again = autoMarkFromTrip(userId, t.id);
		expect(again.countries).toEqual([]);
		expect(again.states).toEqual([]);
		expect(listVisited(userId).countries.map((c) => c.code).sort()).toEqual(['DE', 'FR']);
	});

	test('autoMarkFromTrip skips future-only trips', () => {
		const future = '2999-01-01T00:00:00.000Z';
		const t = makeTrip(ctx.kit, userId, {
			destinationCountryCode: 'ES',
			startDate: '2999-01-01',
			status: 'booked'
		});
		makeSegment(ctx.kit, t.id, { countryCode: 'IT', startAt: future });
		expect(autoMarkFromTrip(userId, t.id)).toEqual({ countries: [], states: [] });
	});

	test('autoMarkFromTrip requires trip ownership', () => {
		const owner = makeUser(ctx.kit);
		const t = makeTrip(ctx.kit, owner.id, { destinationCountryCode: 'FR' });
		expect(() => autoMarkFromTrip(userId, t.id)).toThrow();
	});

	test('autoMarkFromTrip derives US states from destination and segment lat/lng', () => {
		const t = makeTrip(ctx.kit, userId, {
			destinationCountryCode: 'US',
			destinationCityLat: 38.5816,
			destinationCityLng: -121.4944,
			status: 'completed'
		});
		makeSegment(ctx.kit, t.id, {
			countryCode: 'US',
			cityLat: 30.2672,
			cityLng: -97.7431,
			startAt: '2020-01-01T00:00:00.000Z'
		});
		const added = autoMarkFromTrip(userId, t.id);
		expect(added.countries).toEqual(['US']);
		expect(added.states.sort()).toEqual(['CA', 'TX']);
		expect(listVisited(userId).usStates.map((s) => s.code).sort()).toEqual(['CA', 'TX']);
	});

	test('autoMarkFromTrip skips US state when lat/lng are missing', () => {
		const t = makeTrip(ctx.kit, userId, {
			destinationCountryCode: 'US',
			status: 'completed'
		});
		makeSegment(ctx.kit, t.id, {
			countryCode: 'US',
			startAt: '2020-01-01T00:00:00.000Z'
		});
		const added = autoMarkFromTrip(userId, t.id);
		expect(added.countries).toEqual(['US']);
		expect(added.states).toEqual([]);
	});

	test('autoMarkFromAllTrips aggregates across owned trips', () => {
		const t1 = makeTrip(ctx.kit, userId, { destinationCountryCode: 'FR', status: 'completed' });
		const t2 = makeTrip(ctx.kit, userId, { destinationCountryCode: 'PT', status: 'completed' });
		makeSegment(ctx.kit, t1.id, { countryCode: 'DE', startAt: '2020-01-01T00:00:00.000Z' });
		const added = autoMarkFromAllTrips(userId);
		expect(added.countries.sort()).toEqual(['DE', 'FR', 'PT']);
		expect(added.states).toEqual([]);
	});

	test('source check rejects invalid values', () => {
		expect(() =>
			ctx.kit.insertInto(visitedCountries).values({
				user_id: BigInt(userId),
				country_code: 'JP',
				visited_on: null,
				source: 'invalid'
			}).executeSync()
		).toThrow();
	});

	test('countryVisitSummaries returns first/max dates and trip counts', () => {
		markCountryVisited(userId, 'JP', { visitedOn: '2019-04-10' });
		markCountryVisited(userId, 'FR');
		const t1 = makeTrip(ctx.kit, userId, {
			destinationCountryCode: 'JP',
			startDate: '2023-05-01',
			endDate: '2023-05-10',
			status: 'completed'
		});
		const t2 = makeTrip(ctx.kit, userId, {
			destinationCountryCode: 'FR',
			startDate: '2024-01-01',
			endDate: '2024-01-05',
			status: 'completed'
		});
		makeSegment(ctx.kit, t1.id, { countryCode: 'JP', startAt: '2023-05-02T00:00:00.000Z' });
		const summaries = countryVisitSummaries(userId);
		const jp = summaries.find((s) => s.code === 'JP');
		const fr = summaries.find((s) => s.code === 'FR');
		expect(jp).toEqual({ code: 'JP', firstAt: '2019-04-10', lastAt: '2023-05-10', tripCount: 1 });
		expect(fr).toEqual({ code: 'FR', firstAt: '2024-01-01', lastAt: '2024-01-05', tripCount: 1 });
	});
});
