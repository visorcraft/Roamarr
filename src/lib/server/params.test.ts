import { test, expect } from 'vitest';
import { safeNextPath } from './params';

test('safeNextPath keeps same-site paths unchanged', () => {
	expect(safeNextPath('/')).toBe('/');
	expect(safeNextPath('/trips/42')).toBe('/trips/42');
	expect(safeNextPath('/search?q=a%20b&sort=name')).toBe('/search?q=a%20b&sort=name');
	expect(safeNextPath('/trips/42#packing')).toBe('/trips/42#packing');
});

test('safeNextPath rejects missing or non-relative values', () => {
	expect(safeNextPath(null)).toBeNull();
	expect(safeNextPath(undefined)).toBeNull();
	expect(safeNextPath('')).toBeNull();
	expect(safeNextPath('https://evil.example/phish')).toBeNull();
	expect(safeNextPath('//evil.example')).toBeNull();
	expect(safeNextPath('///evil.example')).toBeNull();
	expect(safeNextPath('javascript:alert(1)')).toBeNull();
	expect(safeNextPath('trips/42')).toBeNull();
});

test('safeNextPath rejects a backslash anywhere', () => {
	expect(safeNextPath('/\\evil.example')).toBeNull();
	expect(safeNextPath('/\\\\evil.example')).toBeNull();
	expect(safeNextPath('/trips/42\\..\\evil.example')).toBeNull();
	expect(safeNextPath('/trips?a=b\\c')).toBeNull();
});

test('safeNextPath rejects a control character anywhere, not only in the prefix', () => {
	expect(safeNextPath('/\t/evil.example')).toBeNull();
	expect(safeNextPath('/\n/evil.example')).toBeNull();
	expect(safeNextPath('/\r\n/evil.example')).toBeNull();
	expect(safeNextPath('/tri\u0000ps')).toBeNull();
	expect(safeNextPath('/\u0000')).toBeNull();
	expect(safeNextPath('/\u007f')).toBeNull();
});
