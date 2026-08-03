/**
 * Per-day route optimization for trip itineraries.
 *
 * Only untimed (local-midnight start), coordinate-bearing segments of the day
 * are reordered; timed segments always keep their time order and are never
 * assigned a day_sort_order. The day's lodging (a hotel segment covering the
 * date, when it has coordinates) pins the start of the optimized path.
 * Persisted via segments.day_sort_order and audited as `trip_day_optimize`.
 */

import { error } from '@sveltejs/kit';
import { DateTime } from 'luxon';
import { requireEditableTrip, requireViewableTrip } from './ownership';
import { listSegmentsForTrip, updateSegment } from './repositories/segmentsRepo';
import { optimizeRoute, type GeoPoint } from '$lib/routeOptimize';
import {
	compareSegmentsWithinDay,
	isUntimedSegment,
	segmentLocalDateKey
} from '$lib/segmentDay';
import { logAudit } from './audit';
import { nowIso } from './tz';

export interface TripDayOptimization {
	date: string;
	orderedSegmentIds: number[];
	totalDistanceMeters: number;
	applied: boolean;
}

type SegmentRow = ReturnType<typeof listSegmentsForTrip>[number];

function requireIsoDate(date: string): string {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !DateTime.fromISO(date).isValid) {
		throw error(400, 'Invalid date');
	}
	return date;
}

function hasCoords(s: SegmentRow): boolean {
	return s.cityLat != null && s.cityLng != null;
}

function segmentsForDay(tripId: number, date: string): SegmentRow[] {
	return listSegmentsForTrip(tripId).filter((s) => segmentLocalDateKey(s.startAt, s.startTz) === date);
}

/** The day's lodging anchor: a hotel starting that day, else one spanning it. */
function lodgingStartPoint(daySegments: SegmentRow[], date: string): GeoPoint | null {
	const hotels = daySegments.filter((s) => s.type === 'hotel' && hasCoords(s));
	const startingToday = hotels
		.filter((s) => segmentLocalDateKey(s.startAt, s.startTz) === date)
		.sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? ''));
	const spanning = hotels.filter((s) => {
		const endKey = segmentLocalDateKey(s.endAt, s.endTz ?? s.startTz);
		return endKey != null && endKey >= date;
	});
	const anchor = startingToday[0] ?? spanning[0];
	return anchor ? { lat: anchor.cityLat!, lng: anchor.cityLng! } : null;
}

/**
 * Compute the optimized order for a trip day without persisting anything.
 * Days with fewer than two untimed, coordinate-bearing segments are a no-op:
 * the current order is returned with `applied: false`.
 */
export function planTripDay(userId: number, tripId: number, date: string): TripDayOptimization {
	requireEditableTrip(userId, tripId);
	requireIsoDate(date);
	const daySegments = segmentsForDay(tripId, date);
	const candidates = daySegments
		.filter((s) => isUntimedSegment(s.startAt, s.startTz) && hasCoords(s))
		.sort(compareSegmentsWithinDay);
	if (candidates.length < 2) {
		return {
			date,
			orderedSegmentIds: candidates.map((s) => s.id),
			totalDistanceMeters: 0,
			applied: false
		};
	}
	const start = lodgingStartPoint(daySegments, date);
	const { orderedIds, totalDistanceMeters } = optimizeRoute(
		candidates.map((s) => ({ id: s.id, lat: s.cityLat!, lng: s.cityLng! })),
		start
	);
	return { date, orderedSegmentIds: orderedIds.map(Number), totalDistanceMeters, applied: false };
}

/**
 * Compute and persist the optimized order for a trip day. Writes
 * day_sort_order (1..n in optimized order) for the reordered segments and
 * audits `trip_day_optimize`. No-op days persist nothing and skip the audit.
 */
export function optimizeTripDay(userId: number, tripId: number, date: string): TripDayOptimization {
	const plan = planTripDay(userId, tripId, date);
	if (plan.orderedSegmentIds.length < 2) return plan;
	plan.orderedSegmentIds.forEach((segmentId, index) => {
		updateSegment(segmentId, { day_sort_order: BigInt(index + 1), updated_at: nowIso() });
	});
	logAudit(userId, 'trip_day_optimize', 'trip', tripId, {
		date,
		count: plan.orderedSegmentIds.length,
		totalDistanceMeters: Math.round(plan.totalDistanceMeters)
	});
	return { ...plan, applied: true };
}

/**
 * Coordinate-bearing segments of a trip day in display order (untimed by
 * day_sort_order first, then timed by local time) for directions exports.
 */
export function tripDayDirectionsPoints(userId: number, tripId: number, date: string): GeoPoint[] {
	requireViewableTrip(userId, tripId);
	requireIsoDate(date);
	return segmentsForDay(tripId, date)
		.sort(compareSegmentsWithinDay)
		.filter(hasCoords)
		.map((s) => ({ lat: s.cityLat!, lng: s.cityLng! }));
}
