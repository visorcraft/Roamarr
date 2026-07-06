import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { SeedDateBuilder } from './seedDates';

describe('SeedDateBuilder', () => {
	it('accepts a JS Date anchor', () => {
		const now = new Date('2026-07-10T12:34:56Z');
		const builder = new SeedDateBuilder(now);
		expect(builder.now.toISODate()).toBe('2026-07-10');
	});

	it('accepts a Luxon DateTime anchor', () => {
		const now = DateTime.fromISO('2026-07-10T12:34:56Z').toUTC();
		const builder = new SeedDateBuilder(now);
		expect(builder.now.toISODate()).toBe('2026-07-10');
	});

	it('august expiry picks current year in July', () => {
		const now = DateTime.fromISO('2026-07-10T00:00:00Z').toUTC();
		const builder = new SeedDateBuilder(now);
		expect(builder.augustExpiry()).toBe('2026-08-15');
	});

	it('august expiry picks next year in September', () => {
		const now = DateTime.fromISO('2026-09-01T00:00:00Z').toUTC();
		const builder = new SeedDateBuilder(now);
		expect(builder.augustExpiry()).toBe('2027-08-15');
	});

	it('august expiry picks next year on August 1', () => {
		const now = DateTime.fromISO('2026-08-01T00:00:00Z').toUTC();
		const builder = new SeedDateBuilder(now);
		expect(builder.augustExpiry()).toBe('2027-08-15');
	});

	it('payment due date is roughly 14 days from now', () => {
		const now = DateTime.fromISO('2026-07-10T00:00:00Z').toUTC();
		const builder = new SeedDateBuilder(now);
		const expected = now.plus({ days: 14 }).toISODate();
		expect(builder.paymentDueSoon().paymentDueDate).toBe(expected);
	});

	it('pastTripEarlierThisYear returns a date in the current year', () => {
		const now = DateTime.fromISO('2026-07-10T00:00:00Z').toUTC();
		const builder = new SeedDateBuilder(now);
		const { startDate, endDate } = builder.pastTripEarlierThisYear();
		expect(startDate).toBe('2026-04-01');
		expect(DateTime.fromISO(startDate).year).toBe(2026);
		expect(DateTime.fromISO(endDate).year).toBe(2026);
		expect(endDate).toBe(DateTime.fromISO(startDate).plus({ days: 7 }).toISODate());
	});

	it('pastTripEarlierThisYear clamps to January 1 when three months ago is in the previous year', () => {
		const now = DateTime.fromISO('2026-02-10T00:00:00Z').toUTC();
		const builder = new SeedDateBuilder(now);
		const { startDate, endDate } = builder.pastTripEarlierThisYear();
		expect(startDate).toBe('2026-01-01');
		expect(DateTime.fromISO(startDate).year).toBe(2026);
		expect(DateTime.fromISO(endDate).year).toBe(2026);
		expect(endDate).toBe('2026-01-08');
	});

	it('pastTripLastYear returns a date in the previous year', () => {
		const now = DateTime.fromISO('2026-07-10T00:00:00Z').toUTC();
		const builder = new SeedDateBuilder(now);
		const { startDate, endDate } = builder.pastTripLastYear();
		expect(DateTime.fromISO(startDate).year).toBe(2025);
		expect(DateTime.fromISO(endDate).year).toBe(2025);
		expect(endDate).toBe(DateTime.fromISO(startDate).plus({ days: 10 }).toISODate());
	});

	it('futureTrips all have startDate < endDate in the next calendar year', () => {
		const now = DateTime.fromISO('2026-07-10T00:00:00Z').toUTC();
		const builder = new SeedDateBuilder(now);
		const trips = builder.futureTrips();
		expect(trips).toHaveLength(3);
		expect(trips[0]).toEqual({ name: 'Spring break', startDate: '2027-03-15', endDate: '2027-03-22' });
		expect(trips[1]).toEqual({ name: 'Summer road trip', startDate: '2027-07-10', endDate: '2027-07-24' });
		expect(trips[2]).toEqual({ name: 'Holiday markets', startDate: '2027-12-15', endDate: '2027-12-22' });
		for (const trip of trips) {
			expect(DateTime.fromISO(trip.startDate).toMillis()).toBeLessThan(
				DateTime.fromISO(trip.endDate).toMillis()
			);
			expect(DateTime.fromISO(trip.startDate).year).toBe(2027);
			expect(DateTime.fromISO(trip.endDate).year).toBe(2027);
		}
	});

	it('paymentDueSoon startDate is ~2 months out and endDate is 5 days after start', () => {
		const now = DateTime.fromISO('2026-07-10T00:00:00Z').toUTC();
		const builder = new SeedDateBuilder(now);
		const { startDate, endDate } = builder.paymentDueSoon();
		expect(startDate).toBe(now.plus({ months: 2 }).toISODate());
		expect(endDate).toBe(DateTime.fromISO(startDate).plus({ days: 5 }).toISODate());
	});

	it('sixtyDayExpiry is ~60 days from anchor', () => {
		const now = DateTime.fromISO('2026-07-10T00:00:00Z').toUTC();
		const builder = new SeedDateBuilder(now);
		expect(builder.sixtyDayExpiry()).toBe(now.plus({ days: 60 }).toISODate());
	});

	it('slightlyFuture is after the current UTC time', () => {
		const builder = new SeedDateBuilder();
		const before = DateTime.utc();
		const result = DateTime.fromISO(builder.slightlyFuture());
		const after = DateTime.utc();
		expect(result.toMillis()).toBeGreaterThan(before.toMillis());
		expect(result.toMillis()).toBeLessThan(after.plus({ hours: 2 }).toMillis());
	});
});
