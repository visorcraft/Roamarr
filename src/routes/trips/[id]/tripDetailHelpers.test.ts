import { describe, expect, test } from 'vitest';
import { DateTime } from 'luxon';
import {
	tripDays,
	buildExpensesCsv,
	formatSegmentDuration,
	daysUntilStart,
	posterInitials,
	segmentLocalDateTime,
	groupSegmentsByDay,
	untimedCoordSegments,
	dayCanOptimize,
	dayDirectionsUrl
} from './tripDetailHelpers';

describe('tripDays', () => {
	test('returns null when start or end is missing', () => {
		expect(tripDays(null, '2026-06-10')).toBeNull();
		expect(tripDays('2026-06-01', null)).toBeNull();
		expect(tripDays(undefined, undefined)).toBeNull();
	});

	test('returns null for invalid dates', () => {
		expect(tripDays('not-a-date', '2026-06-10')).toBeNull();
		expect(tripDays('2026-06-01', 'not-a-date')).toBeNull();
	});

	test('counts the same day as one day', () => {
		expect(tripDays('2026-06-01', '2026-06-01')).toBe(1);
	});

	test('counts a multi-day range inclusively', () => {
		expect(tripDays('2026-06-01', '2026-06-05')).toBe(5);
	});
});

describe('buildExpensesCsv', () => {
	test('emits the header row', () => {
		expect(buildExpensesCsv([], new Map())).toBe('"Description","Amount","Currency","Category","Paid by","Date"');
	});

	test('formats amount in major units and resolves owner vs companion payers', () => {
		const csv = buildExpensesCsv(
			[
				{ description: 'Hotel', amount: 12345, currency: 'USD', category: 'lodging', paidBy: 'owner', createdAt: '2026-06-01T10:00:00Z' },
				{ description: 'Dinner', amount: 500, currency: 'EUR', category: 'food', paidBy: 7, createdAt: '2026-06-02T18:30:00Z' },
				{ description: 'Taxi', amount: 2500, currency: 'USD', category: 'transport', paidBy: 99, createdAt: null }
			],
			new Map([[7, 'Alice']])
		);
		const lines = csv.split('\n');
		expect(lines).toHaveLength(4);
		expect(lines[1]).toBe('"Hotel","123.45","USD","lodging","You","2026-06-01T10:00:00Z"');
		expect(lines[2]).toBe('"Dinner","5.00","EUR","food","Alice","2026-06-02T18:30:00Z"');
		expect(lines[3]).toBe('"Taxi","25.00","USD","transport","Unknown",""');
	});

	test('quotes embedded quotes and commas per RFC 4180', () => {
		const csv = buildExpensesCsv(
			[{ description: 'Meal, "spicy"', amount: 100, currency: 'USD', category: null, paidBy: 'owner' }],
			new Map()
		);
		const lines = csv.split('\n');
		expect(lines[1]).toContain('"Meal, ""spicy"""');
		expect(lines[1]).toContain('"1.00"');
	});
});

describe('formatSegmentDuration', () => {
	test('returns null when either side is missing or invalid', () => {
		expect(formatSegmentDuration(null, '2026-06-01T11:00:00Z')).toBeNull();
		expect(formatSegmentDuration('2026-06-01T10:00:00Z', undefined)).toBeNull();
		expect(formatSegmentDuration('garbage', '2026-06-01T11:00:00Z')).toBeNull();
	});

	test('formats sub-hour durations in minutes', () => {
		expect(formatSegmentDuration('2026-06-01T10:00:00Z', '2026-06-01T10:45:00Z')).toBe('45m');
	});

	test('formats hours with and without remaining minutes', () => {
		expect(formatSegmentDuration('2026-06-01T10:00:00Z', '2026-06-01T12:00:00Z')).toBe('2h');
		expect(formatSegmentDuration('2026-06-01T10:00:00Z', '2026-06-01T12:30:00Z')).toBe('2h 30m');
	});

	test('formats multi-day durations in days with and without remaining hours', () => {
		expect(formatSegmentDuration('2026-06-01T00:00:00Z', '2026-06-02T06:00:00Z')).toBe('1d 6h');
		expect(formatSegmentDuration('2026-06-01T00:00:00Z', '2026-06-03T00:00:00Z')).toBe('2d');
	});
});

describe('daysUntilStart', () => {
	const now = DateTime.fromISO('2026-06-15T12:00:00');

	test('returns null for a missing or invalid start', () => {
		expect(daysUntilStart(null, now)).toBeNull();
		expect(daysUntilStart('garbage', now)).toBeNull();
	});

	test('returns null when the trip starts today or earlier', () => {
		expect(daysUntilStart('2026-06-15', now)).toBeNull();
		expect(daysUntilStart('2026-06-01', now)).toBeNull();
	});

	test('counts whole days until the trip start', () => {
		expect(daysUntilStart('2026-06-20', now)).toBe(5);
		expect(daysUntilStart('2026-06-16', now)).toBe(1);
	});
});

describe('posterInitials', () => {
	test('prefers the city name over the trip name', () => {
		expect(posterInitials('My Trip', 'Paris')).toBe('P');
		expect(posterInitials('My Trip', 'New York City')).toBe('NY');
	});

	test('falls back to the trip name when the city is blank', () => {
		expect(posterInitials('John Doe', null)).toBe('JD');
		expect(posterInitials('John Doe', '   ')).toBe('JD');
		expect(posterInitials('Solo', '')).toBe('S');
	});
});

describe('segmentLocalDateTime', () => {
	test('returns null for missing or invalid start times', () => {
		expect(segmentLocalDateTime({ startAt: null })).toBeNull();
		expect(segmentLocalDateTime({ startAt: undefined })).toBeNull();
		expect(segmentLocalDateTime({ startAt: 'garbage' })).toBeNull();
	});

	test('converts UTC start times into the segment timezone', () => {
		const local = segmentLocalDateTime({ startAt: '2026-06-01T10:00:00.000Z', startTz: 'America/New_York' });
		expect(local?.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-06-01 06:00');
	});

	test('defaults to UTC when no timezone is provided', () => {
		const local = segmentLocalDateTime({ startAt: '2026-06-01T10:00:00.000Z' });
		expect(local?.zoneName).toBe('UTC');
	});
});

function segment(partial: {
	startAt?: string | null;
	startTz?: string | null;
	daySortOrder?: number | null;
	cityLat?: number | null;
	cityLng?: number | null;
	title?: string;
}) {
	return { title: 'Segment', ...partial };
}

describe('groupSegmentsByDay', () => {
	test('groups segments by local date and sorts days ascending', () => {
		const groups = groupSegmentsByDay([
			segment({ startAt: '2026-06-02T09:00:00.000Z', startTz: 'UTC', title: 'Day two' }),
			segment({ startAt: '2026-06-01T10:00:00.000Z', startTz: 'UTC', title: 'Day one' })
		]);
		expect(groups.map((g) => g.key)).toEqual(['2026-06-01', '2026-06-02']);
		expect(groups[0].segments[0].title).toBe('Day one');
		expect(groups[0].label).toBe('June 1, 2026');
	});

	test('groups unscheduled segments under the unscheduled bucket', () => {
		const groups = groupSegmentsByDay([
			segment({ startAt: null, title: 'Unscheduled' }),
			segment({ startAt: '2026-06-01T10:00:00.000Z', startTz: 'UTC', title: 'Scheduled' })
		]);
		expect(groups.map((g) => g.key)).toContain('unscheduled');
		const unscheduled = groups.find((g) => g.key === 'unscheduled');
		expect(unscheduled?.label).toBe('Unscheduled');
		expect(unscheduled?.segments[0].title).toBe('Unscheduled');
	});

	test('sorts untimed (local-midnight) segments before timed ones within a day', () => {
		const groups = groupSegmentsByDay([
			segment({ startAt: '2026-06-01T10:00:00.000Z', startTz: 'UTC', title: 'Timed' }),
			segment({ startAt: '2026-06-01T00:00:00.000Z', startTz: 'UTC', title: 'Untimed' })
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].segments.map((s) => s.title)).toEqual(['Untimed', 'Timed']);
	});

	test('reverses day order and within-day order when descending', () => {
		const groups = groupSegmentsByDay(
			[
				segment({ startAt: '2026-06-01T10:00:00.000Z', startTz: 'UTC', title: 'Day one timed' }),
				segment({ startAt: '2026-06-02T09:00:00.000Z', startTz: 'UTC', title: 'Day two timed' })
			],
			false
		);
		expect(groups.map((g) => g.key)).toEqual(['2026-06-02', '2026-06-01']);
	});
});

describe('untimedCoordSegments', () => {
	test('returns [] for the unscheduled bucket', () => {
		expect(untimedCoordSegments({ key: 'unscheduled', segments: [segment({ cityLat: 1, cityLng: 2 })] })).toEqual([]);
	});

	test('keeps only segments with coordinates and a local-midnight start', () => {
		const groups = [
			segment({ startAt: '2026-06-01T00:00:00.000Z', startTz: 'UTC', cityLat: 1, cityLng: 2, title: 'Untimed with coords' }),
			segment({ startAt: '2026-06-01T10:00:00.000Z', startTz: 'UTC', cityLat: 3, cityLng: 4, title: 'Timed with coords' }),
			segment({ startAt: '2026-06-01T00:00:00.000Z', startTz: 'UTC', title: 'Untimed without coords' })
		];
		const group = { key: '2026-06-01', segments: groups };
		expect(untimedCoordSegments(group).map((s) => s.title)).toEqual(['Untimed with coords']);
	});
});

describe('dayCanOptimize', () => {
	test('requires at least two untimed coordinate-bearing segments', () => {
		const two = {
			key: '2026-06-01',
			segments: [
				segment({ startAt: '2026-06-01T00:00:00.000Z', startTz: 'UTC', cityLat: 1, cityLng: 2 }),
				segment({ startAt: '2026-06-01T00:00:00.000Z', startTz: 'UTC', cityLat: 3, cityLng: 4 })
			]
		};
		expect(dayCanOptimize(two)).toBe(true);
		expect(dayCanOptimize({ key: '2026-06-01', segments: [two.segments[0]] })).toBe(false);
		expect(dayCanOptimize({ key: 'unscheduled', segments: two.segments })).toBe(false);
	});
});

describe('dayDirectionsUrl', () => {
	test('returns null for the unscheduled bucket', () => {
		expect(dayDirectionsUrl({ key: 'unscheduled', segments: [segment({ cityLat: 1, cityLng: 2 })] })).toBeNull();
	});

	test('returns null with fewer than two coordinate-bearing segments', () => {
		expect(
			dayDirectionsUrl({ key: '2026-06-01', segments: [segment({ cityLat: 1, cityLng: 2 })] })
		).toBeNull();
		expect(
			dayDirectionsUrl({
				key: '2026-06-01',
				segments: [segment({ cityLat: 1, cityLng: 2 }), segment({ title: 'No coords' })]
			})
		).toBeNull();
	});

	test('builds a Google Maps directions URL from the first and last points', () => {
		const url = dayDirectionsUrl({
			key: '2026-06-01',
			segments: [segment({ cityLat: 37.7749, cityLng: -122.4194 }), segment({ cityLat: 34.0522, cityLng: -118.2437 })]
		});
		expect(url).not.toBeNull();
		expect(url).toContain('https://www.google.com/maps/dir/?');
		expect(url).toContain('api=1');
		expect(url).toContain('origin=37.7749%2C-122.4194');
		expect(url).toContain('destination=34.0522%2C-118.2437');
	});
});
