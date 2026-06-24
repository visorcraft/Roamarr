import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { buildCalendar, type CalendarSegment } from '$lib/server/ical';
import { db } from '$lib/server/db';
import { segments, trips } from '$lib/server/db/schema';
import { viewerProjection } from '$lib/server/sharing';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, url }) => {
	const tripId = Number(params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');

	const token = url.searchParams.get('token');
	if (!token) throw error(404, 'Not found');

	const t = db
		.select()
		.from(trips)
		.where(and(eq(trips.id, tripId), eq(trips.calendarToken, token)))
		.get();
	if (!t) throw error(404, 'Not found');

	const segs = db.select().from(segments).where(eq(segments.tripId, t.id)).all();
	const projection = viewerProjection(t, segs);

	const calendar = buildCalendar(
		{
			id: projection.id,
			name: projection.name,
			destination: projection.destination,
			startDate: projection.startDate,
			endDate: projection.endDate
		},
		projection.segments as CalendarSegment[]
	);

	return new Response(calendar, {
		headers: {
			'Content-Type': 'text/calendar; charset=utf-8',
			'Content-Disposition': `attachment; filename="roamarr-trip-${tripId}.ics"`
		}
	});
};
