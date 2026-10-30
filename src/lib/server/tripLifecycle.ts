import { DateTime } from 'luxon';
import { effectiveTripStatus, todayInTimezone, type TripStatus } from '$lib/tripStatus';
import { getUserById } from './repositories/usersRepo';

export { effectiveTripStatus } from '$lib/tripStatus';

/** Today's calendar date in the user's profile timezone (UTC if unknown). */
export function todayForUser(userId: number, now: DateTime = DateTime.now()): string {
	const timezone = getUserById(userId)?.timezone || 'UTC';
	return todayInTimezone(timezone, now);
}

export function statusForViewer(
	userId: number,
	trip: { status?: string | null; startDate?: string | null; endDate?: string | null },
	today?: string
): TripStatus {
	return effectiveTripStatus(trip, today ?? todayForUser(userId));
}
