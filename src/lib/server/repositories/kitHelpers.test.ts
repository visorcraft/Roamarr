import { test, expect } from 'vitest';
import {
	toBigInt,
	idFromBigInt,
	optionalBigInt,
	optionalNumber,
	optionalFkNumber,
	nullableText
} from './kitHelpers';

test('toBigInt converts a number to bigint', () => {
	expect(toBigInt(42)).toBe(42n);
	expect(toBigInt(0)).toBe(0n);
});

test('idFromBigInt converts bigint to number', () => {
	expect(idFromBigInt(42n)).toBe(42);
	expect(idFromBigInt(0n)).toBe(0);
	expect(idFromBigInt(7)).toBe(7);
});

test('optionalBigInt returns null for null/undefined and bigint otherwise', () => {
	expect(optionalBigInt(null)).toBeNull();
	expect(optionalBigInt(undefined)).toBeNull();
	expect(optionalBigInt(42)).toBe(42n);
	expect(optionalBigInt(0)).toBe(0n);
});

test('optionalNumber returns null for null/undefined and number otherwise', () => {
	expect(optionalNumber(null)).toBeNull();
	expect(optionalNumber(undefined)).toBeNull();
	expect(optionalNumber(42n)).toBe(42);
	expect(optionalNumber(0n)).toBe(0);
});

test('optionalFkNumber returns null for null/undefined and 0n', () => {
	expect(optionalFkNumber(null)).toBeNull();
	expect(optionalFkNumber(undefined)).toBeNull();
	expect(optionalFkNumber(0n)).toBeNull();
	expect(optionalFkNumber(42n)).toBe(42);
});

test('nullableText returns null for null/undefined and empty string', () => {
	expect(nullableText(null)).toBeNull();
	expect(nullableText(undefined)).toBeNull();
	expect(nullableText('')).toBeNull();
	expect(nullableText('hello')).toBe('hello');
});
