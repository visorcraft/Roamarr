import { test, expect } from 'vitest';
import { compareRows } from './sortUtils';

test('compares numbers ascending and descending', () => {
	const rows = [{ n: 1 }, { n: 2 }, { n: 3 }];
	expect(compareRows(rows[1], rows[0], 'n', 'asc')).toBe(1);
	expect(compareRows(rows[0], rows[1], 'n', 'asc')).toBe(-1);
	expect(compareRows(rows[1], rows[1], 'n', 'asc')).toBe(0);
	expect(compareRows(rows[0], rows[1], 'n', 'desc')).toBe(1);
	expect(compareRows(rows[1], rows[0], 'n', 'desc')).toBe(-1);
});

test('compares bigint values as numbers', () => {
	const rows = [{ id: 1n }, { id: 2n }, { id: 10n }];
	expect(compareRows(rows[0], rows[1], 'id', 'asc')).toBe(-1);
	expect(compareRows(rows[2], rows[1], 'id', 'asc')).toBe(1);
	expect(compareRows(rows[2], rows[0], 'id', 'desc')).toBe(-1);
});

test('compares strings case-insensitively', () => {
	const rows = [{ name: 'Apple' }, { name: 'banana' }, { name: 'aPPle' }];
	expect(compareRows(rows[0], rows[1], 'name', 'asc')).toBe(-1);
	expect(compareRows(rows[1], rows[0], 'name', 'asc')).toBe(1);
	expect(compareRows(rows[0], rows[2], 'name', 'asc')).toBe(0);
	expect(compareRows(rows[0], rows[1], 'name', 'desc')).toBe(1);
});

test('sorts booleans with false before true ascending', () => {
	const rows = [{ ok: false }, { ok: true }];
	expect(compareRows(rows[0], rows[1], 'ok', 'asc')).toBe(-1);
	expect(compareRows(rows[1], rows[0], 'ok', 'asc')).toBe(1);
	expect(compareRows(rows[0], rows[1], 'ok', 'desc')).toBe(1);
	expect(compareRows(rows[1], rows[0], 'ok', 'desc')).toBe(-1);
	expect(compareRows(rows[0], rows[0], 'ok', 'asc')).toBe(0);
});

test('treats null and undefined as empty strings', () => {
	const rows = [{ label: null }, { label: 'a' }, { label: undefined }, { label: '' }];
	expect(compareRows(rows[0], rows[2], 'label', 'asc')).toBe(0);
	expect(compareRows(rows[0], rows[1], 'label', 'asc')).toBe(-1);
	expect(compareRows(rows[1], rows[3], 'label', 'asc')).toBe(1);
});

test('mixed string and null sorting is stable by value', () => {
	const rows = [{ label: 'Zebra' }, { label: null }, { label: 'apple' }];
	const sorted = rows.slice().sort((a, b) => compareRows(a, b, 'label', 'asc'));
	expect(sorted.map((r) => r.label)).toEqual([null, 'apple', 'Zebra']);
});
