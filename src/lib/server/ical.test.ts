import { test, expect } from 'vitest';
import { buildCalendar } from './ical';

const trip = {
	id: 1,
	name: 'Summer Escape',
	destination: 'Tokyo, Japan',
	startDate: '2026-07-01',
	endDate: '2026-07-10'
};

test('builds a valid VCALENDAR skeleton', () => {
	const ics = buildCalendar(trip, []);
	expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
	expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
	expect(ics).toContain('VERSION:2.0');
	expect(ics).toContain('PRODID:-//Roamarr//EN');
	expect(ics).toContain('X-WR-CALNAME:Summer Escape');
});

test('renders segment events with UTC datetimes', () => {
	const ics = buildCalendar(trip, [
		{
			type: 'flight',
			title: 'UA123',
			startAt: '2026-07-01T15:00:00Z',
			endAt: '2026-07-01T18:30:00Z',
			location: 'JFK → LHR'
		},
		{
			type: 'lodging',
			title: 'Park Hotel',
			startAt: '2026-07-01T20:00:00Z',
			location: 'Shibuya'
		}
	]);
	expect(ics).toContain('BEGIN:VEVENT');
	expect(ics).toContain('UID:roamarr-trip-1-segment-1@roamarr');
	expect(ics).toContain('UID:roamarr-trip-1-segment-2@roamarr');
	expect(ics).toContain('SUMMARY:Flight: UA123');
	expect(ics).toContain('SUMMARY:Lodging: Park Hotel');
	expect(ics).toContain('DTSTART:20260701T150000Z');
	expect(ics).toContain('DTEND:20260701T183000Z');
	expect(ics).toContain('LOCATION:JFK → LHR');
	expect(ics).toContain('DESCRIPTION:Tokyo\\, Japan');
});

test('escapes special iCal characters in text values', () => {
	const ics = buildCalendar(
		{ id: 2, name: 'Trip; with, newline\nand backslash \\', destination: 'Here; There' },
		[
			{
				type: 'flight',
				title: 'Flight; A,B',
				startAt: '2026-07-01T00:00:00Z'
			}
		]
	);
	expect(ics).toContain('X-WR-CALNAME:Trip\\; with\\, newline\\nand backslash \\\\');
	expect(ics).toContain('SUMMARY:Flight: Flight\\; A\\,B');
	expect(ics).toContain('DESCRIPTION:Here\\; There');
});

test('folds long lines at 75 octets', () => {
	const longTitle = 'A'.repeat(100);
	const ics = buildCalendar(
		{ id: 3, name: 'Trip' },
		[
			{
				type: 'flight',
				title: longTitle,
				startAt: '2026-07-01T00:00:00Z'
			}
		]
	);
	const lines = ics.split('\r\n');
	for (const line of lines) {
		expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
	}
	expect(lines.some((l) => l.startsWith(' ') && l.includes('AAAA'))).toBe(true);
});

test('omits DTEND when segment has no end time', () => {
	const ics = buildCalendar(
		{ id: 4, name: 'Trip' },
		[
			{
				type: 'lodging',
				title: 'Check-in',
				startAt: '2026-07-01T16:00:00Z'
			}
		]
	);
	expect(ics).toContain('DTSTART:20260701T160000Z');
	expect(ics).not.toContain('DTEND');
});
