import { describe, it, expect } from 'vitest';
import { parsePositiveInteger, parseIsoDateParam } from './auditParams';

function expectThrowsWithStatus(fn: () => unknown, status: number) {
	try {
		fn();
		expect.fail('expected function to throw');
	} catch (e: any) {
		expect(e.status).toBe(status);
	}
}

describe('parsePositiveInteger', () => {
	it('returns undefined for null or empty input', () => {
		expect(parsePositiveInteger(null)).toBeUndefined();
		expect(parsePositiveInteger('')).toBeUndefined();
	});

	it('parses valid positive integers', () => {
		expect(parsePositiveInteger('1')).toBe(1);
		expect(parsePositiveInteger('42')).toBe(42);
	});

	it('throws for non-positive integers', () => {
		expectThrowsWithStatus(() => parsePositiveInteger('0'), 400);
		expectThrowsWithStatus(() => parsePositiveInteger('-1'), 400);
		expectThrowsWithStatus(() => parsePositiveInteger('abc'), 400);
	});
});

describe('parseIsoDateParam', () => {
	it('returns undefined for null or empty input', () => {
		expect(parseIsoDateParam(null, 'from')).toBeUndefined();
		expect(parseIsoDateParam('', 'to')).toBeUndefined();
	});

	it('normalizes from date to start of day in UTC', () => {
		expect(parseIsoDateParam('2024-01-15', 'from')).toBe('2024-01-15T00:00:00.000Z');
	});

	it('normalizes to date to end of day in UTC', () => {
		expect(parseIsoDateParam('2024-01-15', 'to')).toBe('2024-01-15T23:59:59.999Z');
	});

	it('throws for invalid dates', () => {
		expectThrowsWithStatus(() => parseIsoDateParam('not-a-date', 'from'), 400);
		expectThrowsWithStatus(() => parseIsoDateParam('bad', 'to'), 400);
	});
});
