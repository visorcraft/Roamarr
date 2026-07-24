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

test('localToUtc ignores trailing Z — digits are wall clock in the zone (MCP client trap)', () => {
	// Agents often emit ISO-with-Z; those digits must still mean local time in startTz.
	expect(localToUtc('2026-12-01T22:50:00.000Z', 'America/Chicago')).toBe('2026-12-02T04:50:00.000Z');
	expect(localToUtc('2027-01-31T12:45:00Z', 'Asia/Bangkok')).toBe('2027-01-31T05:45:00.000Z');
	expect(localToUtc('2026-08-15T14:00:00.000Z', 'Asia/Bangkok')).toBe('2026-08-15T07:00:00.000Z');
});

test('localToUtc ignores numeric offsets the same way', () => {
	expect(localToUtc('2026-12-01T22:50:00-06:00', 'America/Chicago')).toBe('2026-12-02T04:50:00.000Z');
	expect(localToUtc('2026-08-01T15:00:00+07:00', 'Asia/Bangkok')).toBe('2026-08-01T08:00:00.000Z');
});
