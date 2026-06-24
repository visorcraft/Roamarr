import { test, expect } from 'vitest';
import { combineDateTime, parseSegmentDetails } from './segmentForm';

test('combineDateTime merges date and time', () => {
	expect(combineDateTime('2026-08-01', '14:30')).toBe('2026-08-01T14:30');
	expect(combineDateTime('2026-08-01', '')).toBe('2026-08-01T00:00');
});

	test('parseSegmentDetails collects detail and booking fields', () => {
	const f = new FormData();
	f.append('detail_venue', 'Arena');
	f.append('detail_booked', 'on');
	f.append('detail_sameAsPickup', 'on');
	f.append('booking_site', 'Ticketmaster');
	f.append('booking_reference', 'ABC123');

	expect(parseSegmentDetails(f)).toEqual({
		venue: 'Arena',
		booked: true,
		sameAsPickup: true,
		bookingInfo: { site: 'Ticketmaster', reference: 'ABC123' }
	});
});
