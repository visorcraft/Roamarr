/**
 * Shared per-day segment ordering helpers (client + server).
 *
 * Day display-order rule (least surprising):
 * - "Untimed" segments — those whose local start wall clock is exactly
 *   midnight, which is how the segment forms store a date with no time —
 *   come first, ordered by `daySortOrder` (written by the day route
 *   optimizer; nulls keep their natural order and sort last).
 * - Timed segments follow in local-time order.
 *
 * The optimizer therefore never disturbs timed reservations; it only
 * resequences the untimed, coordinate-bearing stops within a day.
 */

import { DateTime } from 'luxon';

export interface DaySegmentLike {
	id?: number;
	startAt: string | null;
	startTz?: string | null;
	daySortOrder?: number | null;
}

export interface FlightBookingLike {
	type: string;
	confirmationNumber?: string | null;
}

export function sameFlightBooking(
	a: FlightBookingLike | null | undefined,
	b: FlightBookingLike | null | undefined
): boolean {
	const reference = a?.confirmationNumber?.trim().toLowerCase();
	return a?.type === 'flight' && b?.type === 'flight' && !!reference && reference === b.confirmationNumber?.trim().toLowerCase();
}

export function segmentLocalDateTime(startAt: string | null, startTz?: string | null): DateTime | null {
	if (!startAt) return null;
	const dt = DateTime.fromISO(startAt, { zone: 'utc' }).setZone(startTz ?? 'UTC');
	return dt.isValid ? dt : null;
}

/** Local calendar date (yyyy-MM-dd) of the segment start, or null. */
export function segmentLocalDateKey(startAt: string | null, startTz?: string | null): string | null {
	return segmentLocalDateTime(startAt, startTz)?.toISODate() ?? null;
}

/** A segment is untimed when its local start wall clock is exactly midnight. */
export function isUntimedSegment(startAt: string | null, startTz?: string | null): boolean {
	const dt = segmentLocalDateTime(startAt, startTz);
	if (!dt) return false;
	return dt.hour === 0 && dt.minute === 0 && dt.second === 0 && dt.millisecond === 0;
}

function localTimeKey(s: DaySegmentLike): string {
	return segmentLocalDateTime(s.startAt, s.startTz)?.toFormat('HH:mm:ss.SSS') ?? '';
}

/** Comparator implementing the day display-order rule documented above. */
export function compareSegmentsWithinDay(a: DaySegmentLike, b: DaySegmentLike): number {
	const aUntimed = isUntimedSegment(a.startAt, a.startTz);
	const bUntimed = isUntimedSegment(b.startAt, b.startTz);
	if (aUntimed !== bUntimed) return aUntimed ? -1 : 1;
	if (aUntimed) {
		const aOrder = a.daySortOrder ?? Number.MAX_SAFE_INTEGER;
		const bOrder = b.daySortOrder ?? Number.MAX_SAFE_INTEGER;
		if (aOrder !== bOrder) return aOrder - bOrder;
	} else {
		const timeCmp = localTimeKey(a).localeCompare(localTimeKey(b));
		if (timeCmp !== 0) return timeCmp;
	}
	// Stable fallback: start time, then id.
	const startCmp = (a.startAt ?? '').localeCompare(b.startAt ?? '');
	if (startCmp !== 0) return startCmp;
	return (a.id ?? 0) - (b.id ?? 0);
}
