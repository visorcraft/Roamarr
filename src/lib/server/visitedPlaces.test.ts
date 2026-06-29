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
	autoMarkCountriesFromTrip,
	autoMarkCountriesFromAllTrips
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

	test('autoMarkCountriesFromTrip marks past segment countries once (idempotent)', () => {
		const t = makeTrip(ctx.kit, userId, { destinationCountryCode: 'FR', status: 'active' });
		makeSegment(ctx.kit, t.id, {
			countryCode: 'DE',
			startAt: '2020-01-01T00:00:00.000Z'
		});
		const added = autoMarkCountriesFromTrip(userId, t.id);
		expect(added.sort()).toEqual(['DE', 'FR']);
		const again = autoMarkCountriesFromTrip(userId, t.id);
		expect(again).toEqual([]);
		expect(listVisited(userId).countries.map((c) => c.code).sort()).toEqual(['DE', 'FR']);
	});

	test('autoMarkCountriesFromTrip skips future-only trips', () => {
		const future = '2999-01-01T00:00:00.000Z';
		const t = makeTrip(ctx.kit, userId, {
			destinationCountryCode: 'ES',
			startDate: '2999-01-01',
			status: 'booked'
		});
		makeSegment(ctx.kit, t.id, { countryCode: 'IT', startAt: future });
		expect(autoMarkCountriesFromTrip(userId, t.id)).toEqual([]);
	});

	test('autoMarkCountriesFromTrip requires trip ownership', () => {
		const owner = makeUser(ctx.kit);
		const t = makeTrip(ctx.kit, owner.id, { destinationCountryCode: 'FR' });
		expect(() => autoMarkCountriesFromTrip(userId, t.id)).toThrow();
	});

	test('autoMarkCountriesFromAllTrips aggregates across owned trips', () => {
		const t1 = makeTrip(ctx.kit, userId, { destinationCountryCode: 'FR', status: 'completed' });
		const t2 = makeTrip(ctx.kit, userId, { destinationCountryCode: 'PT', status: 'completed' });
		makeSegment(ctx.kit, t1.id, { countryCode: 'DE', startAt: '2020-01-01T00:00:00.000Z' });
		const added = autoMarkCountriesFromAllTrips(userId).sort();
		expect(added).toEqual(['DE', 'FR', 'PT']);
	});
});
