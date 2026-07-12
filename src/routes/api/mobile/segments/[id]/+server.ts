import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { getSegmentById, listAttendeesForSegment } from '$lib/server/repositories/segmentsRepo';
import { requireViewableTrip } from '$lib/server/ownership';
import { deleteSegment, updateSegment } from '$lib/server/segments';
import { parseMobileSegment } from '$lib/server/mobileSegments';
import { logAudit } from '$lib/server/audit';
import { utcToLocal } from '$lib/server/tz';
import { canEdit, canViewDetails } from '$lib/server/sharing';

const load = (raw: string | undefined, userId: number) => { const id = Number(raw); if (!Number.isSafeInteger(id) || id < 1) throw error(404, 'Not found'); const segment = getSegmentById(id); if (!segment) throw error(404, 'Not found'); requireViewableTrip(userId, segment.tripId); return segment; };
const editable = (segment: ReturnType<typeof getSegmentById> & {}) => ({ ...segment, localStart: utcToLocal(segment.startAt, segment.startTz), endAt: segment.endAt ? utcToLocal(segment.endAt, segment.endTz ?? segment.startTz) : null, meetingAt: segment.meetingAt ? utcToLocal(segment.meetingAt, segment.startTz) : null });
export const GET: RequestHandler = ({ params, locals }) => {
	const user = requireUser(locals), segment = load(params.id, user.id), trip = requireViewableTrip(user.id, segment.tripId);
	const full = canEdit(user.id, trip) || canViewDetails(user.id, trip);
	const value = editable(segment);
	return json({ segment: full ? value : { id: value.id, tripId: value.tripId, type: value.type, title: value.title, localStart: value.localStart, startTz: value.startTz, endAt: value.endAt, endTz: value.endTz, location: value.location, cityName: value.cityName, countryCode: value.countryCode, venue: value.venue, meetingPoint: value.meetingPoint, meetingAt: value.meetingAt, status: value.status }, attendees: full ? listAttendeesForSegment(segment.id) : [] });
};
export const PATCH: RequestHandler = async ({ params, locals, request }) => { const user = requireUser(locals), old = load(params.id, user.id), body = await request.json() as Record<string, unknown>; const segment = updateSegment(user.id, old.tripId, old.id, parseMobileSegment({ ...editable(old), ...body, type: old.type }, old.startTz)); logAudit(user.id, 'segment_update', 'segment', old.id, { tripId: old.tripId }); return json({ segment }); };
export const DELETE: RequestHandler = ({ params, locals }) => { const user = requireUser(locals), segment = load(params.id, user.id); deleteSegment(user.id, segment.tripId, segment.id); return new Response(null, { status: 204 }); };
