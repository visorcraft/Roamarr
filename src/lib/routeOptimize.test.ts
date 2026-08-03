import { describe, test, expect } from 'vitest';
import { haversineMeters, optimizeRoute } from './routeOptimize';

describe('haversineMeters', () => {
	test('zero distance for identical points', () => {
		expect(haversineMeters({ lat: 40, lng: -74 }, { lat: 40, lng: -74 })).toBe(0);
	});

	test('known distance: one degree of latitude is about 111 km', () => {
		const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
		expect(d).toBeGreaterThan(110000);
		expect(d).toBeLessThan(112500);
	});
});

describe('optimizeRoute', () => {
	test('empty input yields empty order and zero distance', () => {
		expect(optimizeRoute([])).toEqual({ orderedIds: [], totalDistanceMeters: 0 });
	});

	test('single item keeps input order', () => {
		const result = optimizeRoute([{ id: 1, lat: 10, lng: 10 }]);
		expect(result.orderedIds).toEqual([1]);
		expect(result.totalDistanceMeters).toBe(0);
	});

	test('two items keep input order', () => {
		const result = optimizeRoute([
			{ id: 'b', lat: 0, lng: 0 },
			{ id: 'a', lat: 1, lng: 1 }
		]);
		expect(result.orderedIds).toEqual(['b', 'a']);
		expect(result.totalDistanceMeters).toBeGreaterThan(0);
	});

	test('fixed start contributes to the total distance', () => {
		const withoutStart = optimizeRoute([{ id: 1, lat: 0, lng: 0 }]);
		const withStart = optimizeRoute([{ id: 1, lat: 0, lng: 0 }], { lat: 1, lng: 0 });
		expect(withStart.totalDistanceMeters).toBeGreaterThan(withoutStart.totalDistanceMeters);
	});

	test('square: improves the criss-cross order to the loop order', () => {
		// Given in a crossing order (NW, SE, NE, SW) the naive path is long.
		const crossing = [
			{ id: 'nw', lat: 1, lng: 0 },
			{ id: 'se', lat: 0, lng: 1 },
			{ id: 'ne', lat: 1, lng: 1 },
			{ id: 'sw', lat: 0, lng: 0 }
		];
		const result = optimizeRoute(crossing);
		const naive = [
			haversineMeters(crossing[0], crossing[1]),
			haversineMeters(crossing[1], crossing[2]),
			haversineMeters(crossing[2], crossing[3])
		].reduce((a, b) => a + b, 0);
		expect(result.totalDistanceMeters).toBeLessThan(naive);
		// Optimal open loop visits adjacent corners only. Nearest-neighbor seeds
		// the southernmost item (se wins the lat tie by input order) and 2-opt
		// keeps the resulting loop.
		expect(result.orderedIds).toEqual(['se', 'ne', 'nw', 'sw']);
	});

	test('fixed start is honored as the path origin', () => {
		const items = [
			{ id: 'far', lat: 10, lng: 10 },
			{ id: 'near', lat: 0.1, lng: 0 },
			{ id: 'mid', lat: 5, lng: 5 }
		];
		const result = optimizeRoute(items, { lat: 0, lng: 0 });
		expect(result.orderedIds[0]).toBe('near');
		expect(result.orderedIds).toEqual(['near', 'mid', 'far']);
	});

	test('without a start the southernmost item leads', () => {
		const items = [
			{ id: 'north', lat: 10, lng: 0 },
			{ id: 'south', lat: -5, lng: 0 },
			{ id: 'equator', lat: 0, lng: 0 }
		];
		const result = optimizeRoute(items);
		expect(result.orderedIds[0]).toBe('south');
	});

	test('is deterministic across repeated runs', () => {
		const items = [
			{ id: 1, lat: 48.8566, lng: 2.3522 },
			{ id: 2, lat: 41.9028, lng: 12.4964 },
			{ id: 3, lat: 52.52, lng: 13.405 },
			{ id: 4, lat: 40.4168, lng: -3.7038 },
			{ id: 5, lat: 51.5074, lng: -0.1278 },
			{ id: 6, lat: 45.4642, lng: 9.19 }
		];
		const first = optimizeRoute(items, { lat: 50.1109, lng: 8.6821 });
		const second = optimizeRoute([...items].reverse(), { lat: 50.1109, lng: 8.6821 });
		const again = optimizeRoute(items, { lat: 50.1109, lng: 8.6821 });
		expect(again).toEqual(first);
		// Reversed input may produce a different (still valid) order, but never NaN.
		expect(second.totalDistanceMeters).toBeGreaterThan(0);
		expect(second.orderedIds.slice().sort()).toEqual(first.orderedIds.slice().sort());
	});

	test('total distance equals the haversine sum along the returned order', () => {
		const items = [
			{ id: 1, lat: 0, lng: 0 },
			{ id: 2, lat: 0, lng: 2 },
			{ id: 3, lat: 2, lng: 0 },
			{ id: 4, lat: 2, lng: 2 }
		];
		const start = { lat: -1, lng: 1 };
		const result = optimizeRoute(items, start);
		const byId = new Map(items.map((i) => [i.id, i]));
		const byRouteId = (id: number | string) => byId.get(id as number)!;
		let expected = haversineMeters(start, byRouteId(result.orderedIds[0]));
		for (let i = 0; i < result.orderedIds.length - 1; i++) {
			expected += haversineMeters(byRouteId(result.orderedIds[i]), byRouteId(result.orderedIds[i + 1]));
		}
		expect(result.totalDistanceMeters).toBeCloseTo(expected, 6);
	});
});
