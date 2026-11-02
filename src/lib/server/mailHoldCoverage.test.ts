import { expect, test } from 'vitest';
import { coverMailHolds, inclusiveDayCount, nextMailHoldWindow, uspsHoldWarning } from './mailHoldCoverage';

test('inclusive day count treats the end date as covered', () => {
	expect(inclusiveDayCount('2026-01-01', '2026-01-30')).toBe(30);
	expect(inclusiveDayCount('2026-01-01', '2026-01-31')).toBe(31);
});

test('USPS holds longer than 30 days warn and other carriers do not', () => {
	expect(uspsHoldWarning('USPS', '2026-01-01', '2026-01-30')).toBeNull();
	expect(uspsHoldWarning('usps', '2026-01-01', '2026-01-31')).toMatch(/30 days/);
	expect(uspsHoldWarning('Canada Post', '2026-01-01', '2026-03-01')).toBeNull();
});

test('next window is the following 30 inclusive days', () => {
	expect(nextMailHoldWindow('2026-01-30')).toEqual({ startDate: '2026-01-31', endDate: '2026-03-01' });
});

test('coverage reports gaps, ignores cancelled holds, and suggests the next window', () => {
	const report = coverMailHolds('2026-07-01', '2026-07-10', [
		{ id: 1, carrier: 'USPS', startDate: '2026-07-01', endDate: '2026-07-04', status: 'active', addressLabel: 'Home' },
		{ id: 2, carrier: 'USPS', startDate: '2026-07-08', endDate: '2026-07-09', status: 'requested' },
		{ id: 3, carrier: 'USPS', startDate: '2026-07-05', endDate: '2026-07-07', status: 'cancelled' }
	]);
	expect(report.awayDatesKnown).toBe(true);
	expect(report.uncoveredDays).toEqual(['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-10']);
	expect(report.uncoveredRanges).toEqual([
		{ start: '2026-07-05', end: '2026-07-07' },
		{ start: '2026-07-10', end: '2026-07-10' }
	]);
	expect(report.renewals).toEqual([
		{ id: 1, renewalDate: '2026-07-04' },
		{ id: 2, renewalDate: '2026-07-09' }
	]);
	expect(report.suggestedNext).toMatchObject({ startDate: '2026-07-10', endDate: '2026-08-08', carrier: 'USPS' });
});

test('coverage is empty when the trip has no away dates', () => {
	const report = coverMailHolds(null, null, []);
	expect(report.awayDatesKnown).toBe(false);
	expect(report.uncoveredDays).toEqual([]);
	expect(report.suggestedNext).toBeNull();
});
