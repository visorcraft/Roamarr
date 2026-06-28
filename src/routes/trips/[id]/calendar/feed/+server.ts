import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { buildCalendar, type CalendarSegment } from '$lib/server/ical';
import { parseTripId } from '$lib/server/params';
import { db } from '$lib/server/db';
import { segments, trips } from '$lib/server/db/schema';
import { viewerProjection } from '$lib/server/sharing';
import { checkRateLimit } from '$lib/server/rateLimit';
import { isExpired } from '$lib/server/dates';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, url, getClientAddress }) => {
	const ip = getClientAddress();
	const limit = checkRateLimit(ip, 'calendar:feed', { maxAttempts: 30, windowMs: 60_000 });
	if (!limit.allowed) {
		return new Response('Too many requests', {
			status: 429,
			headers: { 'Retry-After': String(limit.retryAfter ?? 60) }
		});
	}

	const tripId = parseTripId(params);

	const token = url.searchParams.get('token');
	if (!token) throw error(404, 'Not found');

	const t = db
		.select()
		.from(trips)
		.where(and(eq(trips.id, tripId), eq(trips.calendarToken, token)))
		.get();
	if (!t || isExpired(t.calendarTokenExpiresAt)) throw error(404, 'Not found');

	const segs = db.select().from(segments).where(eq(segments.tripId, t.id)).all();
	const projection = viewerProjection(t, segs);

	const calendar = buildCalendar(
		{
			id: projection.id,
			name: projection.name,
			destinationCityName: projection.destinationCityName,
			destinationCountryCode: projection.destinationCountryCode,
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
