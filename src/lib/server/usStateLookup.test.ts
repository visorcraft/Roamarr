import { describe, test, expect } from 'vitest';
import { lookupUsStateFromLatLng } from './usStateLookup';

describe('usStateLookup', () => {
	test('looks up continental US state capitals', () => {
		expect(lookupUsStateFromLatLng(39.7392, -104.9903)).toBe('US-CO'); // Denver
		expect(lookupUsStateFromLatLng(41.8781, -87.6298)).toBe('US-IL'); // Chicago
		expect(lookupUsStateFromLatLng(38.5816, -121.4944)).toBe('US-CA'); // Sacramento
		expect(lookupUsStateFromLatLng(30.2672, -97.7431)).toBe('US-TX'); // Austin
		expect(lookupUsStateFromLatLng(47.6062, -122.3321)).toBe('US-WA'); // Seattle
	});

	test('looks up Alaska and Hawaii', () => {
		expect(lookupUsStateFromLatLng(61.2181, -149.9003)).toBe('US-AK'); // Anchorage
		expect(lookupUsStateFromLatLng(21.3099, -157.8581)).toBe('US-HI'); // Honolulu
	});

	test('returns null for points outside the US', () => {
		expect(lookupUsStateFromLatLng(48.8566, 2.3522)).toBeNull(); // Paris
		expect(lookupUsStateFromLatLng(0, 0)).toBeNull();
	});

	test('returns null for invalid inputs', () => {
		expect(lookupUsStateFromLatLng(NaN, -100)).toBeNull();
		expect(lookupUsStateFromLatLng(40, NaN)).toBeNull();
	});
});
