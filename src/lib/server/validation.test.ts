import { test, expect } from 'vitest';
import { Validator } from './validation';

test('requiredString rejects empty, whitespace, non-string, and enforces max', () => {
	const v = new Validator();
	expect(v.requiredString('', 'name')).toBeUndefined();
	expect(v.errors.name).toBe('name is required');

	const v2 = new Validator();
	expect(v2.requiredString('   ', 'name')).toBeUndefined();
	expect(v2.errors.name).toBe('name is required');

	const v3 = new Validator();
	expect(v3.requiredString(null, 'name')).toBeUndefined();
	expect(v3.errors.name).toBe('name is required');

	const v4 = new Validator();
	expect(v4.requiredString('abc', 'name', { max: 2 })).toBe('abc');
	expect(v4.errors.name).toBe('name must be at most 2 characters');

	const v5 = new Validator();
	expect(v5.requiredString('  hello  ', 'name')).toBe('hello');
	expect(v5.ok()).toBe(true);
});

test('optionalString trims and ignores empty', () => {
	const v = new Validator();
	expect(v.optionalString('', 'x')).toBeUndefined();
	expect(v.optionalString('  ', 'x')).toBeUndefined();
	expect(v.optionalString('  hi  ', 'x')).toBe('hi');
	expect(v.optionalString(123 as any, 'x')).toBeUndefined();
	expect(v.errors.x).toBe('x must be a string');
});

test('enumValue validates against allowed values', () => {
	const v = new Validator();
	expect(v.enumValue('private', ['private', 'public'] as const, 'vis')).toBe('private');
	expect(v.enumValue('secret', ['private', 'public'] as const, 'vis')).toBeUndefined();
	expect(v.errors.vis).toBe('vis must be one of: private, public');
});

test('timezone validates IANA zones', () => {
	const v = new Validator();
	expect(v.timezone('America/New_York', 'tz')).toBe('America/New_York');
	expect(v.timezone('Mars/Colony', 'tz')).toBeUndefined();
	expect(v.errors.tz).toBe('tz must be a valid IANA timezone');

	const v2 = new Validator();
	expect(v2.timezone('', 'tz')).toBeUndefined();
	expect(v2.errors.tz).toBe('tz is required');
});

test('date validates YYYY-MM-DD format', () => {
	const v = new Validator();
	expect(v.date('2026-07-01', 'd')).toBe('2026-07-01');
	expect(v.date('', 'd')).toBeUndefined();
	expect(v.date('2026-7-1', 'd')).toBeUndefined();
	expect(v.date('2026-02-30', 'd')).toBeUndefined();
	expect(v.date('2026-07-01T00:00:00Z', 'd')).toBeUndefined();
	expect(v.errors.d).toBe('d must be a valid date (YYYY-MM-DD)');
});

test('requiredDate enforces presence', () => {
	const v = new Validator();
	expect(v.requiredDate('', 'd')).toBeUndefined();
	expect(v.errors.d).toBe('d is required');
});

test('dateTime validates ISO datetimes', () => {
	const v = new Validator();
	expect(v.dateTime('2026-07-01T15:00', 'dt')).toBe('2026-07-01T15:00');
	expect(v.dateTime('', 'dt')).toBeUndefined();
	expect(v.dateTime('not-a-date', 'dt')).toBeUndefined();
	expect(v.errors.dt).toBe('dt must be a valid datetime');
});

test('requiredDateTime enforces presence', () => {
	const v = new Validator();
	expect(v.requiredDateTime('', 'dt')).toBeUndefined();
	expect(v.errors.dt).toBe('dt is required');
});

test('positiveId validates positive integers', () => {
	const v = new Validator();
	expect(v.positiveId('1', 'id')).toBe(1);
	expect(v.positiveId(42, 'id')).toBe(42);
	expect(v.positiveId('0', 'id')).toBeUndefined();
	expect(v.positiveId('-1', 'id')).toBeUndefined();
	expect(v.positiveId('abc', 'id')).toBeUndefined();
	expect(v.positiveId('', 'id')).toBeUndefined();
	expect(v.positiveId('1.5', 'id')).toBeUndefined();
});

test('dateRange checks ordering', () => {
	const v = new Validator();
	v.dateRange('2026-07-01', '2026-07-10');
	expect(v.ok()).toBe(true);

	const v2 = new Validator();
	v2.dateRange('2026-07-10', '2026-07-01');
	expect(v2.errors.startDate).toBe('startDate must be on or before endDate');
});

test('validator collects multiple errors', () => {
	const v = new Validator();
	v.requiredString('', 'name');
	v.enumValue('x', ['a', 'b'] as const, 'type');
	v.timezone('Mars', 'tz');
	expect(v.ok()).toBe(false);
	expect(Object.keys(v.errors)).toHaveLength(3);
});
