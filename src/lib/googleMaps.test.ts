import { describe, test, expect } from 'vitest';
import { buildGoogleMapsDirectionsUrl, GOOGLE_MAPS_MAX_WAYPOINTS } from './googleMaps';

describe('buildGoogleMapsDirectionsUrl', () => {
	test('returns null for zero or one point', () => {
		expect(buildGoogleMapsDirectionsUrl([])).toBeNull();
		expect(buildGoogleMapsDirectionsUrl([{ lat: 1, lng: 2 }])).toBeNull();
	});

	test('two points become origin and destination without waypoints', () => {
		const url = buildGoogleMapsDirectionsUrl([
			{ lat: 48.8566, lng: 2.3522 },
			{ lat: 41.9028, lng: 12.4964 }
		])!;
		expect(url).toContain('https://www.google.com/maps/dir/?');
		const params = new URL(url).searchParams;
		expect(params.get('api')).toBe('1');
		expect(params.get('origin')).toBe('48.8566,2.3522');
		expect(params.get('destination')).toBe('41.9028,12.4964');
		expect(params.get('waypoints')).toBeNull();
	});

	test('middle points become pipe-separated waypoints', () => {
		const url = buildGoogleMapsDirectionsUrl([
			{ lat: 1, lng: 1 },
			{ lat: 2, lng: 2 },
			{ lat: 3, lng: 3 },
			{ lat: 4, lng: 4 }
		])!;
		const params = new URL(url).searchParams;
		expect(params.get('origin')).toBe('1,1');
		expect(params.get('destination')).toBe('4,4');
		expect(params.get('waypoints')).toBe('2,2|3,3');
	});

	test('caps waypoints at the Google Maps limit while keeping the final destination', () => {
		const points = Array.from({ length: 14 }, (_, i) => ({ lat: i + 1, lng: i + 1 }));
		const url = buildGoogleMapsDirectionsUrl(points)!;
		const params = new URL(url).searchParams;
		expect(params.get('origin')).toBe('1,1');
		expect(params.get('destination')).toBe('14,14');
		const waypoints = params.get('waypoints')!.split('|');
		expect(waypoints).toHaveLength(GOOGLE_MAPS_MAX_WAYPOINTS);
		// Total routed points never exceed origin + destination + 9 waypoints.
		expect(waypoints.length + 2).toBeLessThanOrEqual(11);
	});

	test('skips non-finite coordinates', () => {
		const url = buildGoogleMapsDirectionsUrl([
			{ lat: 1, lng: 1 },
			{ lat: Number.NaN, lng: 5 },
			{ lat: 2, lng: 2 }
		])!;
		const params = new URL(url).searchParams;
		expect(params.get('origin')).toBe('1,1');
		expect(params.get('destination')).toBe('2,2');
		expect(params.get('waypoints')).toBeNull();
	});

	test('returns null when fewer than two valid points remain', () => {
		expect(
			buildGoogleMapsDirectionsUrl([
				{ lat: 1, lng: 1 },
				{ lat: Number.POSITIVE_INFINITY, lng: 0 }
			])
		).toBeNull();
	});
});
