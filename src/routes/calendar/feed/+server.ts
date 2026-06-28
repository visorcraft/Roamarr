import { error } from '@sveltejs/kit';
import { buildAggregateCalendar, type CalendarSegment, type CalendarTrip } from '$lib/server/ical';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
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
				destinationCityName: view.trip.destinationCityName,
				destinationCountryCode: view.trip.destinationCountryCode,
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
			destinationCityName: view.trip.destinationCityName,
			destinationCountryCode: view.trip.destinationCountryCode,
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

	const u = usersRepo.getUserByCalendarToken(token);
	if (!u || isExpired(u.calendar_token_expires_at)) throw error(404, 'Not found');

	const userId = Number(u.id);
	const tripIds = tripsRepo.listViewableTripIdsForUser(userId);

	const inputs = tripIds
		.map((tripId) => {
			try {
				return toCalendarInput(loadTripFor(userId, tripId));
			} catch {
				return null;
			}
		})
		.filter((input): input is { trip: CalendarTrip; segments: CalendarSegment[] } => input != null);

	const calendar = buildAggregateCalendar(`Roamarr - ${u.display_name ?? ''}`, inputs);

	return new Response(calendar, {
		headers: {
			'Content-Type': 'text/calendar; charset=utf-8',
			'Content-Disposition': 'attachment; filename="roamarr-calendar.ics"'
		}
	});
};
