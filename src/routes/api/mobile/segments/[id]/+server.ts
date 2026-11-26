import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePositiveId } from '$lib/server/params';
import { requireUser } from '$lib/server/auth';
import { getSegmentById, listAttendeesForSegment } from '$lib/server/repositories/segmentsRepo';
import { requireViewableTrip } from '$lib/server/ownership';
import { deleteSegment, updateSegment } from '$lib/server/segments';
import { parseMobileSegment } from '$lib/server/mobileSegments';
import { logAudit } from '$lib/server/audit';
import { utcToLocal } from '$lib/server/tz';
import { canEdit, canViewDetails } from '$lib/server/sharing';

const load = (raw: string | undefined, userId: number) => { const id = requirePositiveId(raw); const segment = getSegmentById(id); if (!segment) throw error(404, 'Not found'); requireViewableTrip(userId, segment.tripId); return segment; };
const editable = (segment: ReturnType<typeof getSegmentById> & {}) => ({ ...segment, localStart: utcToLocal(segment.startAt, segment.startTz), endAt: segment.endAt ? utcToLocal(segment.endAt, segment.endTz ?? segment.startTz) : null, meetingAt: segment.meetingAt ? utcToLocal(segment.meetingAt, segment.startTz) : null });
const projectSegment = (segment: ReturnType<typeof getSegmentById> & {}, full: boolean) => {
	const value = editable(segment);
	return full
		? value
		: {
				id: value.id,
				tripId: value.tripId,
				type: value.type,
				title: value.title,
				localStart: value.localStart,
				startTz: value.startTz,
				endAt: value.endAt,
				endTz: value.endTz,
				location: value.location,
				cityName: value.cityName,
				countryCode: value.countryCode,
				venue: value.venue,
				meetingPoint: value.meetingPoint,
				meetingAt: value.meetingAt,
				status: value.status
			};
};
export const GET: RequestHandler = ({ params, locals }) => {
	const user = requireUser(locals), segment = load(params.id, user.id), trip = requireViewableTrip(user.id, segment.tripId);
	// Private segment details follow the web viewerProjection / MCP rule: show-details consent is required even for editors.
	const editor = canEdit(user.id, trip);
	const full = canViewDetails(user.id, trip);
	return json({ segment: projectSegment(segment, full), attendees: editor || full ? listAttendeesForSegment(segment.id) : [] });
};
export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	const user = requireUser(locals), old = load(params.id, user.id), trip = requireViewableTrip(user.id, old.tripId), body = await request.json() as Record<string, unknown>;
	const segment = updateSegment(user.id, old.tripId, old.id, parseMobileSegment({ ...editable(old), ...body, type: old.type }, old.startTz));
	logAudit(user.id, 'segment_update', 'segment', old.id, { tripId: old.tripId });
	const full = canViewDetails(user.id, trip);
	return json({ segment: full ? segment : projectSegment(segment, false) });
};
export const DELETE: RequestHandler = ({ params, locals }) => { const user = requireUser(locals), segment = load(params.id, user.id); deleteSegment(user.id, segment.tripId, segment.id); return new Response(null, { status: 204 }); };
