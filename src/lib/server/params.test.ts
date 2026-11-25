import { test, expect } from 'vitest';
import { safeNextPath, parsePositiveId, parseTripId } from './params';

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

test('parsePositiveId accepts plain decimal digit strings', () => {
	expect(parsePositiveId('7')).toBe(7);
	expect(parsePositiveId('007')).toBe(7);
	expect(parsePositiveId('9007199254740991')).toBe(9007199254740991);
});

test('parsePositiveId returns null for malformed values', () => {
	expect(parsePositiveId(null)).toBeNull();
	expect(parsePositiveId(undefined)).toBeNull();
	expect(parsePositiveId(7)).toBeNull();
	expect(parsePositiveId('')).toBeNull();
	expect(parsePositiveId('0')).toBeNull();
	expect(parsePositiveId('-3')).toBeNull();
	expect(parsePositiveId('+5')).toBeNull();
	expect(parsePositiveId('1.5')).toBeNull();
	expect(parsePositiveId('1e3')).toBeNull();
	expect(parsePositiveId('0x10')).toBeNull();
	expect(parsePositiveId(' 12')).toBeNull();
	expect(parsePositiveId('12\n')).toBeNull();
	expect(parsePositiveId('Infinity')).toBeNull();
	expect(parsePositiveId('abc')).toBeNull();
	expect(parsePositiveId('9007199254740992')).toBeNull();
	expect(parsePositiveId('99999999999999999999')).toBeNull();
});

test('parseTripId returns a number for plain decimal digit strings', () => {
	expect(parseTripId({ id: '42' })).toBe(42);
	expect(parseTripId({ id: '007' })).toBe(7);
});

test('parseTripId throws 404 Not found for malformed ids', () => {
	for (const id of ['abc', '', '0', '-3', '1.5', '1e3', '0x10', ' 12', '99999999999999999999']) {
		expect(() => parseTripId({ id })).toThrowError(expect.objectContaining({ status: 404, body: { status: 404, message: 'Not found' } }));
	}
});
