import { DateTime } from 'luxon';
import type { SegmentType } from './db/mongrelSchema';
import { formatDestination } from '$lib/tripDestination';
import { nowIso } from './tz';

export type CalendarTrip = {
	id: number;
	name: string;
	destinationCityName?: string | null;
	destinationCountryCode?: string | null;
	startDate?: string | null;
	endDate?: string | null;
};

export type CalendarSegment = {
	type: SegmentType;
	title: string;
	startAt: string;
	endAt?: string | null;
	location?: string | null;
};

const SEGMENT_LABELS: Record<SegmentType, string> = {
	flight: 'Flight',
	event: 'Event',
	hotel: 'Hotel',
	rental_car: 'Rental car',
	note: 'Note',
	todo: 'Todo',
	parking: 'Parking',
	boat: 'Boat',
	train: 'Train',
	directions: 'Directions',
	food: 'Food',
	poi: 'POI',
	meetup: 'Meetup',
	rideshare: 'Rideshare',
	shuttle: 'Shuttle'
};

// Content lines are delimited by CRLF only, so a raw carriage return inside a
// value (lone CR, or the CR of a CRLF) is read as a line break by CR-tolerant
// calendar clients and would let trip text inject property lines.
function escapeText(value: string): string {
	return value
		.replace(/\r\n?/g, '\n')
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\n/g, '\\n');
}

function take(line: string, maxBytes: number): [string, string] {
	let slice = line.slice(0, maxBytes);
	while (Buffer.byteLength(slice) > maxBytes && slice.length > 1) {
		slice = slice.slice(0, slice.length - 1);
	}
	return [slice, line.slice(slice.length)];
}

function foldLine(input: string): string {
	return input
		.split('\r\n')
		.flatMap((line) => {
			const [first, rest] = take(line, 75);
			const lines = [first];
			let remaining = rest;
			while (remaining.length > 0) {
				const [chunk, next] = take(remaining, 74);
				lines.push(' ' + chunk);
				remaining = next;
			}
			return lines;
		})
		.join('\r\n');
}

const UTC_FORMAT = "yyyyMMdd'T'HHmmss'Z'";

function formatUtcDateTime(iso: string): string {
	const dt = DateTime.fromISO(iso, { zone: 'utc' });
	if (!dt.isValid) throw new Error(`invalid datetime: ${iso}`);
	return dt.toFormat(UTC_FORMAT);
}

function parseUtcDateTime(value: unknown): DateTime | null {
	if (typeof value !== 'string') return null;
	const dt = DateTime.fromISO(value, { zone: 'utc' });
	return dt.isValid ? dt : null;
}

function buildEvent(trip: CalendarTrip, segment: CalendarSegment, index: number, stamp: string): string | null {
	const start = parseUtcDateTime(segment.startAt);
	if (!start) return null;
	const end = segment.endAt ? parseUtcDateTime(segment.endAt) : null;
	const uid = `roamarr-trip-${trip.id}-segment-${index + 1}@roamarr`;
	const label = SEGMENT_LABELS[segment.type] ?? segment.type;
	const summary = `${label}: ${segment.title}`;
	const lines: string[] = [];

	lines.push('BEGIN:VEVENT');
	lines.push(`UID:${uid}`);
	lines.push(`DTSTAMP:${stamp}`);
	lines.push(`SUMMARY:${escapeText(summary)}`);
	lines.push(`DTSTART:${start.toFormat(UTC_FORMAT)}`);
	if (end && end.toMillis() >= start.toMillis()) {
		lines.push(`DTEND:${end.toFormat(UTC_FORMAT)}`);
	}
	if (segment.location) {
		lines.push(`LOCATION:${escapeText(segment.location)}`);
	}
	const destinationLabel = formatDestination(trip.destinationCityName, trip.destinationCountryCode);
	if (destinationLabel) {
		lines.push(`DESCRIPTION:${escapeText(destinationLabel)}`);
	}
	lines.push('END:VEVENT');

	return lines.map(foldLine).join('\r\n');
}

/**
 * Trip bounds are calendar dates: only the leading YYYY-MM-DD counts, so a
 * trailing clock or offset (`2026-07-10T23:30:00-05:00`) cannot shift the
 * all-day event by a day. Returns null for anything that is not a real date.
 */
function parseTripDate(value: string): DateTime | null {
	const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!match) return null;
	const dt = DateTime.fromObject(
		{ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) },
		{ zone: 'utc' }
	);
	return dt.isValid ? dt : null;
}

function buildTripEvent(trip: CalendarTrip, stamp: string): string | null {
	const start = trip.startDate ? parseTripDate(trip.startDate) : null;
	if (!start) return null;
	const uid = `roamarr-trip-${trip.id}@roamarr`;
	const lines: string[] = [];
	const destinationLabel = formatDestination(trip.destinationCityName, trip.destinationCountryCode);
	lines.push('BEGIN:VEVENT');
	lines.push(`UID:${uid}`);
	lines.push(`DTSTAMP:${stamp}`);
	lines.push(`SUMMARY:${escapeText(trip.name)}`);
	lines.push(`DTSTART;VALUE=DATE:${start.toFormat('yyyyMMdd')}`);
	if (trip.endDate) {
		const end = parseTripDate(trip.endDate);
		if (end) {
			const exclusive = end.plus({ days: 1 });
			if (exclusive.toMillis() > start.toMillis()) {
				lines.push(`DTEND;VALUE=DATE:${exclusive.toFormat('yyyyMMdd')}`);
			}
		}
	}
	if (destinationLabel) {
		lines.push(`DESCRIPTION:${escapeText(destinationLabel)}`);
	}
	lines.push('END:VEVENT');
	return lines.map(foldLine).join('\r\n');
}

export function buildCalendar(trip: CalendarTrip, segments: CalendarSegment[]): string {
	const stamp = formatUtcDateTime(nowIso());

	const parts: string[] = [];
	parts.push('BEGIN:VCALENDAR');
	parts.push(`VERSION:2.0`);
	parts.push(`PRODID:-//Roamarr//EN`);
	parts.push(`CALSCALE:GREGORIAN`);
	parts.push(`METHOD:PUBLISH`);
	parts.push(`X-WR-CALNAME:${escapeText(trip.name)}`);
	parts.push(`X-WR-TIMEZONE:UTC`);

	const tripEvent = buildTripEvent(trip, stamp);
	if (tripEvent) parts.push(tripEvent);

	segments.forEach((segment, index) => {
		const event = buildEvent(trip, segment, index, stamp);
		if (event) parts.push(event);
	});

	parts.push('END:VCALENDAR');

	return parts.map(foldLine).join('\r\n') + '\r\n';
}

export function buildAggregateCalendar(
	calendarName: string,
	trips: { trip: CalendarTrip; segments: CalendarSegment[] }[]
): string {
	const stamp = formatUtcDateTime(nowIso());

	const parts: string[] = [];
	parts.push('BEGIN:VCALENDAR');
	parts.push(`VERSION:2.0`);
	parts.push(`PRODID:-//Roamarr//EN`);
	parts.push(`CALSCALE:GREGORIAN`);
	parts.push(`METHOD:PUBLISH`);
	parts.push(`X-WR-CALNAME:${escapeText(calendarName)}`);
	parts.push(`X-WR-TIMEZONE:UTC`);

	for (const { trip, segments } of trips) {
		const tripEvent = buildTripEvent(trip, stamp);
		if (tripEvent) parts.push(tripEvent);

		segments.forEach((segment, index) => {
			const event = buildEvent(trip, segment, index, stamp);
			if (event) parts.push(event);
		});
	}

	parts.push('END:VCALENDAR');

	return parts.map(foldLine).join('\r\n') + '\r\n';
}
