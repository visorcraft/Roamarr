import { DateTime } from 'luxon';

export const TRIP_STATUSES = ['planning', 'booked', 'active', 'completed'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

/**
 * Calendar day (YYYY-MM-DD) in an IANA timezone. Invalid zones fall back to UTC
 * so a bad profile value cannot throw while listing trips.
 */
export function todayInTimezone(timezone: string, now: DateTime = DateTime.now()): string {
	const zoned = now.setZone(timezone);
	const day = (zoned.isValid ? zoned : now.toUTC()).toISODate();
	return day ?? now.toUTC().toISODate()!;
}

/**
 * Status shown in the UI and APIs.
 *
 * The stored status is the user's explicit choice (planning vs booked, or an
 * early "completed" / "active" mark) and is never rewritten. Dates only move
 * the displayed status forward, using `today` in the viewer's profile timezone:
 *
 * - end date strictly before today → completed (the end date itself is still
 *   current; a trip that ends today stays in progress until that local day ends)
 * - today is inside [start, end] → active, unless the user already marked it
 *   completed
 * - otherwise the stored status is kept, including a future trip marked
 *   completed or active, and any trip that has no end date
 */
export function effectiveTripStatus(
	trip: { status?: string | null; startDate?: string | null; endDate?: string | null },
	today: string
): TripStatus {
	const stored: TripStatus = (TRIP_STATUSES as readonly string[]).includes(trip.status ?? '')
		? (trip.status as TripStatus)
		: 'booked';

	if (trip.endDate && trip.endDate < today) return 'completed';

	if (
		trip.startDate &&
		trip.endDate &&
		trip.startDate <= today &&
		trip.endDate >= today &&
		stored !== 'completed'
	) {
		return 'active';
	}

	return stored;
}

const TRIP_STATUS_BADGE: Record<TripStatus, { label: string; class: string }> = {
	planning: { label: 'Planning', class: 'badge-slate' },
	booked: { label: 'Booked', class: 'badge-brand' },
	active: { label: 'Active', class: 'badge-green' },
	completed: { label: 'Completed', class: 'badge-amber' }
};

export function tripStatusBadge(status: string): { label: string; class: string } {
	return TRIP_STATUS_BADGE[status as TripStatus] ?? { label: status, class: 'badge-slate' };
}
