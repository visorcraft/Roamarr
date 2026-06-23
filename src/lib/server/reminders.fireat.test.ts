import { test, expect } from 'vitest';
import { computeFireAt } from './reminders';
import { localToUtc } from './tz';

test('flight check-in is 24h before the UTC departure instant', () => {
	expect(computeFireAt('flight_checkin', '2026-07-01T15:00:00.000Z')).toBe(
		'2026-06-30T15:00:00.000Z'
	);
});

test('document expiry fires 09:00 user-local, 90 days prior, in UTC', () => {
	expect(computeFireAt('document_expiry', '2026-12-30', 'America/New_York')).toBe(
		'2026-10-01T13:00:00.000Z'
	);
});

test('localToUtc converts wall-clock + zone to instant', () => {
	expect(localToUtc('2026-07-01T15:00:00', 'America/New_York')).toBe('2026-07-01T19:00:00.000Z');
});
