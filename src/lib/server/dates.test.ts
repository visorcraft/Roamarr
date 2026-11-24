import { describe, test, expect } from 'vitest';
import { isExpired } from './dates';

describe('isExpired', () => {
	test('returns false for null and undefined (no expiry configured)', () => {
		expect(isExpired(null)).toBe(false);
		expect(isExpired(undefined)).toBe(false);
	});

	test('returns false for empty and whitespace-only strings (blank deadline)', () => {
		expect(isExpired('')).toBe(false);
		expect(isExpired('   ')).toBe(false);
	});

	test('returns true for a past ISO deadline', () => {
		expect(isExpired('2020-01-01T00:00:00Z')).toBe(true);
	});

	test('returns false for a future ISO deadline', () => {
		expect(isExpired('2999-01-01T00:00:00Z')).toBe(false);
	});

	test('returns false for a future date-only string', () => {
		expect(isExpired('2999-01-01')).toBe(false);
	});

	test('returns true for unparseable strings (fail closed)', () => {
		for (const value of ['not-a-date', '2026-W45-3']) {
			expect(Number.isNaN(Date.parse(value))).toBe(true);
			expect(isExpired(value)).toBe(true);
		}
	});
});
