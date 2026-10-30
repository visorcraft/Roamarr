import { describe, expect, test } from 'vitest';
import { DateTime } from 'luxon';
import { effectiveTripStatus, todayInTimezone } from './tripStatus';

describe('todayInTimezone', () => {
	test('uses the profile timezone when UTC has already rolled to the next day', () => {
		// 2026-10-31 04:30 UTC is still 2026-10-30 23:30 in America/Chicago (CDT, UTC-5).
		const now = DateTime.fromISO('2026-10-31T04:30:00.000Z', { setZone: true });
		expect(todayInTimezone('America/Chicago', now)).toBe('2026-10-30');
		expect(todayInTimezone('UTC', now)).toBe('2026-10-31');
	});

	test('falls back to UTC for an invalid timezone', () => {
		const now = DateTime.fromISO('2026-10-31T04:30:00.000Z', { setZone: true });
		expect(todayInTimezone('Not/AZone', now)).toBe('2026-10-31');
	});
});

describe('effectiveTripStatus', () => {
	const chicagoToday = '2026-10-30';

	test('a booked trip whose end date has passed is completed', () => {
		expect(
			effectiveTripStatus(
				{ status: 'booked', startDate: '2026-08-14', endDate: '2026-09-07' },
				chicagoToday
			)
		).toBe('completed');
	});

	test('a trip that ends today is still active', () => {
		expect(
			effectiveTripStatus(
				{ status: 'booked', startDate: '2026-10-01', endDate: '2026-10-30' },
				chicagoToday
			)
		).toBe('active');
	});

	test('the same end date is completed once that timezone is on the next day', () => {
		const now = DateTime.fromISO('2026-10-31T04:30:00.000Z', { setZone: true });
		const trip = { status: 'booked' as const, startDate: '2026-10-01', endDate: '2026-10-30' };
		expect(effectiveTripStatus(trip, todayInTimezone('America/Chicago', now))).toBe('active');
		expect(effectiveTripStatus(trip, todayInTimezone('UTC', now))).toBe('completed');
	});

	test('an in-progress trip is active even when the saved status is planning or booked', () => {
		const trip = { startDate: '2026-10-01', endDate: '2026-11-15' };
		expect(effectiveTripStatus({ ...trip, status: 'planning' }, chicagoToday)).toBe('active');
		expect(effectiveTripStatus({ ...trip, status: 'booked' }, chicagoToday)).toBe('active');
	});

	test('an explicit completed mark is kept while the trip is still in progress', () => {
		expect(
			effectiveTripStatus(
				{ status: 'completed', startDate: '2026-10-01', endDate: '2026-11-15' },
				chicagoToday
			)
		).toBe('completed');
	});

	test('future trips keep an explicit saved status', () => {
		const dates = { startDate: '2026-12-01', endDate: '2027-01-31' };
		expect(effectiveTripStatus({ ...dates, status: 'booked' }, chicagoToday)).toBe('booked');
		expect(effectiveTripStatus({ ...dates, status: 'planning' }, chicagoToday)).toBe('planning');
		expect(effectiveTripStatus({ ...dates, status: 'active' }, chicagoToday)).toBe('active');
		expect(effectiveTripStatus({ ...dates, status: 'completed' }, chicagoToday)).toBe('completed');
	});

	test('a missing end date does not invent a completed or active status', () => {
		expect(
			effectiveTripStatus({ status: 'planning', startDate: '2026-07-01', endDate: null }, chicagoToday)
		).toBe('planning');
		expect(effectiveTripStatus({ status: 'booked', startDate: null, endDate: null }, chicagoToday)).toBe(
			'booked'
		);
	});

	test('a past end date overrides a saved planning or active status', () => {
		const dates = { startDate: '2026-08-14', endDate: '2026-09-07' };
		expect(effectiveTripStatus({ ...dates, status: 'planning' }, chicagoToday)).toBe('completed');
		expect(effectiveTripStatus({ ...dates, status: 'active' }, chicagoToday)).toBe('completed');
	});
});
