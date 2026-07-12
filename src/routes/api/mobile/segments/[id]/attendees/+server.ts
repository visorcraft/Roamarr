import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { getSegmentById } from '$lib/server/repositories/segmentsRepo';
import { deleteAttendee, listAttendeesForSegment, upsertAttendee } from '$lib/server/segmentAttendees';
import { SEGMENT_ATTENDEE_STATUSES, type SegmentAttendeeStatus } from '$lib/server/db/mongrelSchema';
import { requireViewableTrip } from '$lib/server/ownership';

const segment = (raw: string | undefined) => { const id = Number(raw), value = Number.isSafeInteger(id) ? getSegmentById(id) : null; if (!value) throw error(404, 'Segment not found'); return value; };
export const GET: RequestHandler = ({ params, locals }) => { const user = requireUser(locals), item = segment(params.id); requireViewableTrip(user.id, item.tripId); return json({ rows: listAttendeesForSegment(item.id) }); };
export const POST: RequestHandler = async ({ params, locals, request }) => { const user = requireUser(locals), item = segment(params.id), body = await request.json() as Record<string, unknown>, companionId = Number(body.companionId), status = String(body.status ?? 'going'); if (!Number.isSafeInteger(companionId) || companionId < 1 || !SEGMENT_ATTENDEE_STATUSES.includes(status as SegmentAttendeeStatus)) throw error(400, 'Invalid attendee'); upsertAttendee(user.id, item.tripId, item.id, companionId, status as SegmentAttendeeStatus); return json({ ok: true }); };
export const DELETE: RequestHandler = async ({ params, locals, request }) => { const user = requireUser(locals), item = segment(params.id), body = await request.json() as Record<string, unknown>, companionId = Number(body.companionId); if (!Number.isSafeInteger(companionId) || companionId < 1) throw error(400, 'Invalid attendee'); deleteAttendee(user.id, item.tripId, item.id, companionId); return new Response(null, { status: 204 }); };
