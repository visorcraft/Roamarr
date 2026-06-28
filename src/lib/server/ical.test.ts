import { test, expect } from 'vitest';
import { buildCalendar, buildAggregateCalendar } from './ical';

const trip = {
	id: 1,
	name: 'Summer Escape',
	destinationCityName: 'Tokyo',
	destinationCountryCode: 'JP',
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
			type: 'hotel',
			title: 'Park Hotel',
			startAt: '2026-07-01T20:00:00Z',
			location: 'Shibuya'
		}
	]);
	expect(ics).toContain('BEGIN:VEVENT');
	expect(ics).toContain('UID:roamarr-trip-1-segment-1@roamarr');
	expect(ics).toContain('UID:roamarr-trip-1-segment-2@roamarr');
	expect(ics).toContain('SUMMARY:Flight: UA123');
	expect(ics).toContain('SUMMARY:Hotel: Park Hotel');
	expect(ics).toContain('DTSTART:20260701T150000Z');
	expect(ics).toContain('DTEND:20260701T183000Z');
	expect(ics).toContain('LOCATION:JFK → LHR');
	expect(ics).toContain('DESCRIPTION:Tokyo\\, Japan');
});

test('escapes special iCal characters in text values', () => {
	const ics = buildCalendar(
		{ id: 2, name: 'Trip; with, newline\nand backslash \\', destinationCityName: 'Here; There', destinationCountryCode: null },
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

test('renders a trip-bounds all-day event', () => {
	const ics = buildCalendar(trip, []);
	expect(ics).toContain('UID:roamarr-trip-1@roamarr');
	expect(ics).toContain('DTSTART;VALUE=DATE:20260701');
	expect(ics).toContain('DTEND;VALUE=DATE:20260711');
	expect(ics).toContain('SUMMARY:Summer Escape');
});

test('renders all segment types', () => {
	const ics = buildCalendar(
		{ id: 5, name: 'Multi' },
		[
			{ type: 'rental_car', title: 'Rental', startAt: '2026-07-01T10:00:00Z' },
			{ type: 'poi', title: 'Museum', startAt: '2026-07-02T10:00:00Z' },
			{ type: 'food', title: 'Dinner', startAt: '2026-07-03T19:00:00Z' }
		] as any
	);
	expect(ics).toContain('SUMMARY:Rental car: Rental');
	expect(ics).toContain('SUMMARY:POI: Museum');
	expect(ics).toContain('SUMMARY:Food: Dinner');
});

test('omits DTEND when segment has no end time', () => {
	const ics = buildCalendar(
		{ id: 4, name: 'Trip' },
		[
			{
				type: 'hotel',
				title: 'Check-in',
				startAt: '2026-07-01T16:00:00Z'
			}
		]
	);
	expect(ics).toContain('DTSTART:20260701T160000Z');
	expect(ics).not.toContain('DTEND');
});

test('buildAggregateCalendar combines multiple trips and their segments', () => {
	const ics = buildAggregateCalendar('All Trips', [
		{
			trip: { id: 1, name: 'Trip A', startDate: '2026-07-01' },
			segments: [
				{
					type: 'flight',
					title: 'AA1',
					startAt: '2026-07-01T10:00:00Z',
					endAt: '2026-07-01T13:00:00Z'
				}
			]
		},
		{
			trip: { id: 2, name: 'Trip B', startDate: '2026-08-01' },
			segments: [
				{
					type: 'hotel',
					title: 'Inn',
					startAt: '2026-08-01T15:00:00Z'
				}
			]
		}
	]);
	expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
	expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
	expect(ics).toContain('X-WR-CALNAME:All Trips');
	expect(ics).toContain('UID:roamarr-trip-1@roamarr');
	expect(ics).toContain('UID:roamarr-trip-2@roamarr');
	expect(ics).toContain('UID:roamarr-trip-1-segment-1@roamarr');
	expect(ics).toContain('UID:roamarr-trip-2-segment-1@roamarr');
	expect(ics).toContain('SUMMARY:Flight: AA1');
	expect(ics).toContain('SUMMARY:Hotel: Inn');
});

test('buildAggregateCalendar works for an empty trip list', () => {
	const ics = buildAggregateCalendar('Empty', []);
	expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
	expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
	expect(ics).toContain('X-WR-CALNAME:Empty');
	expect(ics).not.toContain('BEGIN:VEVENT');
});
