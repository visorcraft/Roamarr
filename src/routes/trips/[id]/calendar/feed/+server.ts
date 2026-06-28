import { error } from '@sveltejs/kit';
import { buildCalendar, type CalendarSegment } from '$lib/server/ical';
import { parseTripId } from '$lib/server/params';
import { viewerProjection } from '$lib/server/sharing';
import { listSegmentsForTrip } from '$lib/server/repositories/segmentsRepo';
import { checkRateLimit } from '$lib/server/rateLimit';
import { isExpired } from '$lib/server/dates';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
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

	const t = tripsRepo.getTripByCalendarToken(token);
	if (!t || t.id !== tripId || isExpired(t.calendarTokenExpiresAt)) throw error(404, 'Not found');

	const segs = listSegmentsForTrip(t.id);
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
