import { test, expect } from 'vitest';
import { computeFireAt } from './reminders';
import { localToUtc } from './tz';

test('flight check-in is 24h before the UTC departure instant by default', () => {
	expect(computeFireAt('flight_checkin', '2026-07-01T15:00:00.000Z')).toBe(
		'2026-06-30T15:00:00.000Z'
	);
});

test('flight check-in uses the configured lead hours', () => {
	expect(
		computeFireAt('flight_checkin', '2026-07-01T15:00:00.000Z', { flightCheckinLeadHours: 48 })
	).toBe('2026-06-29T15:00:00.000Z');
	expect(
		computeFireAt('flight_checkin', '2026-07-01T15:00:00.000Z', { flightCheckinLeadHours: 0 })
	).toBe('2026-07-01T15:00:00.000Z');
});

test('document expiry fires 09:00 user-local, 90 days prior, in UTC by default', () => {
	expect(computeFireAt('document_expiry', '2026-12-30', { tz: 'America/New_York' })).toBe(
		'2026-10-01T13:00:00.000Z'
	);
});

test('document expiry uses the configured lead days', () => {
	expect(
		computeFireAt('document_expiry', '2026-12-30', { tz: 'America/New_York', documentExpiryLeadDays: 30 })
	).toBe('2026-11-30T14:00:00.000Z');
});

test('localToUtc converts wall-clock + zone to instant', () => {
	expect(localToUtc('2026-07-01T15:00:00', 'America/New_York')).toBe('2026-07-01T19:00:00.000Z');
});
