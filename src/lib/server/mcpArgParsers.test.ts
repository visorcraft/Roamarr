import { describe, test, expect } from 'vitest';
import {
	toPositiveIdArg,
	positiveId,
	optionalPositiveId,
	validateToolInput,
	parseReminderOffsetMinutes,
	parseBudgetSetArgs,
	parseShareArgs,
	parseSegmentUpdateArgs,
	parseTripFieldsArgs,
	parsePlaceLinkArgs,
	attachmentFilename
} from './mcpArgParsers';

describe('positive ID parsers', () => {
	test('toPositiveIdArg accepts positive safe integer numbers and decimal strings', () => {
		expect(toPositiveIdArg(7)).toBe(7);
		expect(toPositiveIdArg('42')).toBe(42);
		expect(toPositiveIdArg('007')).toBe(7);
		expect(toPositiveIdArg(0)).toBeNull();
		expect(toPositiveIdArg(-1)).toBeNull();
		expect(toPositiveIdArg(1.5)).toBeNull();
		expect(toPositiveIdArg('abc')).toBeNull();
		expect(toPositiveIdArg(null)).toBeNull();
	});

	test('positiveId returns integer or throws 400 with field name', () => {
		expect(positiveId(5, 'tripId')).toBe(5);
		expect(positiveId('12', 'tripId')).toBe(12);
		expect(() => positiveId(0, 'tripId')).toThrowError(
			expect.objectContaining({ status: 400, body: expect.objectContaining({ message: 'tripId must be a positive integer' }) })
		);
		expect(() => positiveId('', 'docId')).toThrowError(expect.objectContaining({ status: 400 }));
	});

	test('optionalPositiveId returns null for absent values and validates present ones', () => {
		expect(optionalPositiveId(undefined, 'tripId')).toBeNull();
		expect(optionalPositiveId(null, 'tripId')).toBeNull();
		expect(optionalPositiveId('', 'tripId')).toBeNull();
		expect(optionalPositiveId(9, 'tripId')).toBe(9);
		expect(() => optionalPositiveId(-2, 'tripId')).toThrowError(expect.objectContaining({ status: 400 }));
	});
});

describe('validateToolInput', () => {
	test('accepts valid enums, datetimes, and timezones', () => {
		expect(
			validateToolInput({
				status: 'booked',
				type: 'flight',
				category: 'transport',
				startAt: '2026-06-01T10:00:00Z',
				startTz: 'America/New_York'
			})
		).toEqual({ ok: true });
	});

	test('rejects invalid enum or timezone values', () => {
		const res = validateToolInput({ status: 'bogus', startTz: 'Not/A_Zone' });
		expect(res.ok).toBe(false);
	});
});

describe('parseReminderOffsetMinutes', () => {
	test('accepts integers in [-10080, 10080] and rejects invalid or out-of-range values', () => {
		expect(parseReminderOffsetMinutes(0)).toBe(0);
		expect(parseReminderOffsetMinutes(-10080)).toBe(-10080);
		expect(parseReminderOffsetMinutes('60')).toBe(60);
		expect(parseReminderOffsetMinutes(10081)).toBeNull();
		expect(parseReminderOffsetMinutes(1.5)).toBeNull();
		expect(parseReminderOffsetMinutes('')).toBeNull();
		expect(parseReminderOffsetMinutes(null)).toBeNull();
	});
});

describe('parseBudgetSetArgs', () => {
	test('parses valid args and defaults currency to USD', () => {
		expect(parseBudgetSetArgs({ tripId: 1, category: 'food', amount: 5000 })).toEqual({
			ok: true,
			tripId: 1,
			category: 'food',
			amount: 5000,
			currency: 'USD'
		});
		expect(parseBudgetSetArgs({ tripId: 2, category: ' lodging ', amount: 1000, currency: 'eur' })).toEqual({
			ok: true,
			tripId: 2,
			category: 'lodging',
			amount: 1000,
			currency: 'EUR'
		});
	});

	test('rejects bad tripId, category, amount, or currency', () => {
		expect(parseBudgetSetArgs({ tripId: '1', category: 'food', amount: 500 }).ok).toBe(false);
		expect(parseBudgetSetArgs({ tripId: 1, category: 'unknown', amount: 500 }).ok).toBe(false);
		expect(parseBudgetSetArgs({ tripId: 1, category: 'food', amount: 0 }).ok).toBe(false);
		expect(parseBudgetSetArgs({ tripId: 1, category: 'food', amount: 500, currency: 'US' }).ok).toBe(false);
	});
});

describe('parseShareArgs', () => {
	test('accepts valid permission and strict boolean showDetails', () => {
		expect(parseShareArgs({ permission: 'edit', showDetails: false })).toEqual({
			ok: true,
			permission: 'edit',
			showDetails: false
		});
		expect(parseShareArgs({ showDetails: 'false' }).ok).toBe(false);
		expect(parseShareArgs({ permission: 'admin' }).ok).toBe(false);
	});
});

describe('parseSegmentUpdateArgs', () => {
	test('returns only supplied fields and allows null only on nullable fields', () => {
		expect(parseSegmentUpdateArgs({ title: 'Flight', venue: null, cityLat: 35.6 })).toEqual({
			ok: true,
			patch: { title: 'Flight', venue: null, cityLat: 35.6 }
		});
		expect(parseSegmentUpdateArgs({ title: null }).ok).toBe(false);
		expect(parseSegmentUpdateArgs({ cityLat: 95 }).ok).toBe(false);
		expect(parseSegmentUpdateArgs({}).ok).toBe(false);
	});
});

describe('parseTripFieldsArgs', () => {
	test('requires name on create, allows partial update, and validates date ranges', () => {
		expect(parseTripFieldsArgs({ name: 'Tokyo', baseCurrency: 'jpy' }, null)).toEqual({
			ok: true,
			fields: { name: 'Tokyo', baseCurrency: 'JPY' }
		});
		expect(parseTripFieldsArgs({ notes: 'updated' }, { startDate: '2026-05-01', endDate: '2026-05-10' })).toEqual({
			ok: true,
			fields: { notes: 'updated' }
		});
		expect(parseTripFieldsArgs({ endDate: '2026-04-01' }, { startDate: '2026-05-01', endDate: '2026-05-10' }).ok).toBe(false);
	});
});

describe('parsePlaceLinkArgs', () => {
	test('validates linkId and optional string/null fields', () => {
		expect(parsePlaceLinkArgs({ linkId: 4, label: 'Map', notes: null })).toEqual({
			ok: true,
			linkId: 4,
			patch: { label: 'Map', notes: null },
			empty: false
		});
		expect(parsePlaceLinkArgs({ linkId: 4 })).toEqual({ ok: true, linkId: 4, patch: {}, empty: true });
		expect(parsePlaceLinkArgs({ linkId: '4' }).ok).toBe(false);
		expect(parsePlaceLinkArgs({ linkId: 4, label: 123 }).ok).toBe(false);
	});
});

describe('attachmentFilename', () => {
	test('accepts safe basenames and rejects path separators or traversal', () => {
		expect(attachmentFilename('boarding-pass.pdf')).toBe('boarding-pass.pdf');
		expect(() => attachmentFilename('../secret.pdf')).toThrowError(expect.objectContaining({ status: 400 }));
		expect(() => attachmentFilename('..')).toThrowError(expect.objectContaining({ status: 400 }));
	});
});
