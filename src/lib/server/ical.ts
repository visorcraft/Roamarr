import { DateTime } from 'luxon';
import type { SegmentType } from './db/schema';

type CalendarTrip = {
	id: number;
	name: string;
	destination?: string | null;
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

function escapeText(value: string): string {
	return value
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

function formatUtcDateTime(iso: string): string {
	const dt = DateTime.fromISO(iso, { zone: 'utc' });
	if (!dt.isValid) throw new Error(`invalid datetime: ${iso}`);
	return dt.toFormat("yyyyMMdd'T'HHmmss'Z'");
}

function formatDate(iso: string): string {
	const dt = DateTime.fromISO(iso, { zone: 'utc' });
	if (!dt.isValid) throw new Error(`invalid date: ${iso}`);
	return dt.toFormat('yyyyMMdd');
}

function buildEvent(trip: CalendarTrip, segment: CalendarSegment, index: number, stamp: string): string {
	const uid = `roamarr-trip-${trip.id}-segment-${index + 1}@roamarr`;
	const label = SEGMENT_LABELS[segment.type] ?? segment.type;
	const summary = `${label}: ${segment.title}`;
	const lines: string[] = [];

	lines.push('BEGIN:VEVENT');
	lines.push(`UID:${uid}`);
	lines.push(`DTSTAMP:${stamp}`);
	lines.push(`SUMMARY:${escapeText(summary)}`);
	lines.push(`DTSTART:${formatUtcDateTime(segment.startAt)}`);
	if (segment.endAt) {
		lines.push(`DTEND:${formatUtcDateTime(segment.endAt)}`);
	}
	if (segment.location) {
		lines.push(`LOCATION:${escapeText(segment.location)}`);
	}
	if (trip.destination) {
		lines.push(`DESCRIPTION:${escapeText(trip.destination)}`);
	}
	lines.push('END:VEVENT');

	return lines.map(foldLine).join('\r\n');
}

function buildTripEvent(trip: CalendarTrip, stamp: string): string | null {
	if (!trip.startDate) return null;
	const uid = `roamarr-trip-${trip.id}@roamarr`;
	const lines: string[] = [];
	lines.push('BEGIN:VEVENT');
	lines.push(`UID:${uid}`);
	lines.push(`DTSTAMP:${stamp}`);
	lines.push(`SUMMARY:${escapeText(trip.name)}`);
	lines.push(`DTSTART;VALUE=DATE:${formatDate(trip.startDate)}`);
	if (trip.endDate) {
		const end = DateTime.fromISO(trip.endDate, { zone: 'utc' }).plus({ days: 1 });
		lines.push(`DTEND;VALUE=DATE:${end.toFormat('yyyyMMdd')}`);
	}
	if (trip.destination) {
		lines.push(`DESCRIPTION:${escapeText(trip.destination)}`);
	}
	lines.push('END:VEVENT');
	return lines.map(foldLine).join('\r\n');
}

export function buildCalendar(trip: CalendarTrip, segments: CalendarSegment[]): string {
	const stamp = formatUtcDateTime(DateTime.utc().toISO()!);

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
		parts.push(buildEvent(trip, segment, index, stamp));
	});

	parts.push('END:VCALENDAR');

	return parts.map(foldLine).join('\r\n') + '\r\n';
}
