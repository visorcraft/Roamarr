import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { buildAggregateCalendar, type CalendarSegment, type CalendarTrip } from '$lib/server/ical';
import { db } from '$lib/server/db';
import { users, trips, tripShares, groupMembers } from '$lib/server/db/schema';
import { loadTripFor } from '../../trips/shared';
import { checkRateLimit } from '$lib/server/rateLimit';
import { isExpired } from '$lib/server/dates';
import type { RequestHandler } from './$types';

function toCalendarInput(
	view: ReturnType<typeof loadTripFor>
): { trip: CalendarTrip; segments: CalendarSegment[] } {
	if (view.editor) {
		return {
			trip: {
				id: view.trip.id,
				name: view.trip.name,
				destination: view.trip.destination,
				startDate: view.trip.startDate,
				endDate: view.trip.endDate
			},
			segments: view.segments.map((s) => ({
				type: s.type as CalendarSegment['type'],
				title: s.title,
				startAt: s.startAt,
				endAt: s.endAt,
				location: s.location
			}))
		};
	}
	return {
		trip: {
			id: view.trip.id,
			name: view.trip.name,
			destination: view.trip.destination,
			startDate: view.trip.startDate,
			endDate: view.trip.endDate
		},
		segments: view.trip.segments as CalendarSegment[]
	};
}

export const GET: RequestHandler = ({ url, getClientAddress }) => {
	const ip = getClientAddress();
	const limit = checkRateLimit(ip, 'calendar:feed', { maxAttempts: 30, windowMs: 60_000 });
	if (!limit.allowed) {
		return new Response('Too many requests', {
			status: 429,
			headers: { 'Retry-After': String(limit.retryAfter ?? 60) }
		});
	}

	const token = url.searchParams.get('token');
	if (!token) throw error(404, 'Not found');

	const u = db.select().from(users).where(eq(users.calendarToken, token)).get();
	if (!u || isExpired(u.calendarTokenExpiresAt)) throw error(404, 'Not found');

	const owned = db.select().from(trips).where(eq(trips.ownerId, u.id)).all();
	const sharedByUser = db
		.select({ trip: trips })
		.from(trips)
		.innerJoin(tripShares, eq(trips.id, tripShares.tripId))
		.where(eq(tripShares.sharedWithUserId, u.id))
		.all();
	const sharedByGroup = db
		.select({ trip: trips })
		.from(trips)
		.innerJoin(tripShares, eq(trips.id, tripShares.tripId))
		.innerJoin(groupMembers, eq(tripShares.sharedWithGroupId, groupMembers.groupId))
		.where(eq(groupMembers.userId, u.id))
		.all();

	const map = new Map<number, Parameters<typeof loadTripFor>[1]>();
	for (const t of owned) map.set(t.id, t.id);
	for (const { trip: t } of [...sharedByUser, ...sharedByGroup]) {
		if (map.has(t.id)) continue;
		map.set(t.id, t.id);
	}

	const inputs = Array.from(map.values())
		.map((tripId) => {
			try {
				return toCalendarInput(loadTripFor(u.id, tripId));
			} catch {
				return null;
			}
		})
		.filter((input): input is { trip: CalendarTrip; segments: CalendarSegment[] } => input != null);

	const calendar = buildAggregateCalendar(`Roamarr - ${u.displayName}`, inputs);

	return new Response(calendar, {
		headers: {
			'Content-Type': 'text/calendar; charset=utf-8',
			'Content-Disposition': 'attachment; filename="roamarr-calendar.ics"'
		}
	});
};
