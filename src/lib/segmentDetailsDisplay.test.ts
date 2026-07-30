import { expect, test } from 'vitest';
import {
	formatDetailValue,
	humanizeDetailKey,
	segmentNotesRows
} from './segmentDetailsDisplay';

test('humanizeDetailKey splits camelCase and snake_case', () => {
	expect(humanizeDetailKey('bookingInfo')).toBe('Booking Info');
	expect(humanizeDetailKey('party_size')).toBe('Party Size');
	expect(humanizeDetailKey('sameAsPickup')).toBe('Same As Pickup');
	expect(humanizeDetailKey('whatsapp')).toBe('Whatsapp');
});

test('formatDetailValue presents booleans and primitives cleanly', () => {
	expect(formatDetailValue(true)).toBe('Yes');
	expect(formatDetailValue(false)).toBe('No');
	expect(formatDetailValue('Klook')).toBe('Klook');
	expect(formatDetailValue(42)).toBe('42');
	expect(formatDetailValue(['A', 'B'])).toBe('A, B');
});

test('segmentNotesRows flattens bookingInfo into labeled fields', () => {
	const rows = segmentNotesRows({
		attendees: 'Oland Whitecotton',
		booked: true,
		bookingInfo: {
			site: 'Klook Travel',
			reference: 'ZCA560574',
			website: 'https://www.klook.com/',
			date: '2026-04-28',
			phone: '+66-21148844'
		},
		provider: 'TTD GLOBAL CO., LTD.',
		phone: '+66-21148844',
		email: 'booking.transport@ttdthailand.com',
		whatsapp: '+66 994838455',
		notes: 'TTD GLOBAL CO., LTD. TEL: +66-21148844'
	});

	expect(rows).toEqual([
		{ label: 'Attendees', value: 'Oland Whitecotton' },
		{ label: 'Booked', value: 'Yes' },
		{ label: 'Booking site', value: 'Klook Travel' },
		{ label: 'Booking reference', value: 'ZCA560574' },
		{ label: 'Booking website', value: 'https://www.klook.com/' },
		{ label: 'Booking date', value: '2026-04-28' },
		{ label: 'Booking phone', value: '+66-21148844' },
		{ label: 'Provider', value: 'TTD GLOBAL CO., LTD.' },
		{ label: 'Phone', value: '+66-21148844' },
		{ label: 'Email', value: 'booking.transport@ttdthailand.com' },
		{ label: 'WhatsApp', value: '+66 994838455' },
		{ label: 'Notes', value: 'TTD GLOBAL CO., LTD. TEL: +66-21148844' }
	]);

	// Never dump a JSON blob for bookingInfo itself.
	expect(rows.some((r) => r.label === 'Booking Info' || r.value.includes('"site"'))).toBe(false);
});

test('segmentNotesRows skips empty nested booking fields', () => {
	expect(
		segmentNotesRows({
			bookingInfo: { site: 'Expedia', reference: '', website: '  ' },
			notes: ''
		})
	).toEqual([{ label: 'Booking site', value: 'Expedia' }]);
});

test('segmentNotesRows labels unknown nested objects without stringifying', () => {
	expect(
		segmentNotesRows({
			contact: { name: 'Desk', extension: '12' }
		})
	).toEqual([
		{ label: 'Contact · Name', value: 'Desk' },
		{ label: 'Contact · Extension', value: '12' }
	]);
});
