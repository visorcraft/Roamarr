import { requireUser } from '$lib/server/auth';
import { buildCalendar, type CalendarSegment } from '$lib/server/ical';
import { parseTripId } from '$lib/server/params';
import { loadTripFor } from '../../shared';
import type { RequestHandler } from './$types';

function toCalendarSegments(view: ReturnType<typeof loadTripFor>): CalendarSegment[] {
	if (view.editor) {
		return view.segments.map((s) => ({
			type: s.type as CalendarSegment['type'],
			title: s.title,
			startAt: s.startAt,
			endAt: s.endAt,
			location: s.location
		}));
	}
	return view.trip.segments as CalendarSegment[];
}

export const GET: RequestHandler = ({ locals, params }) => {
	const u = requireUser(locals);
	const tripId = parseTripId(params);

	const view = loadTripFor(u.id, tripId);
	const tripInput = {
		id: view.trip.id,
		name: view.trip.name,
		destination: view.trip.destination,
		startDate: view.trip.startDate,
		endDate: view.trip.endDate
	};
	const calendar = buildCalendar(tripInput, toCalendarSegments(view));

	return new Response(calendar, {
		headers: {
			'Content-Type': 'text/calendar; charset=utf-8',
			'Content-Disposition': `attachment; filename="roamarr-trip-${tripId}.ics"`
		}
	});
};
