import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import {
	listAttendeesForSegment as listAttendeesForSegmentRepo,
	listAttendeesForSegments as listAttendeesForSegmentsRepo,
	upsertAttendee as upsertAttendeeRepo,
	removeAttendeeBySegmentAndCompanion,
	getSegmentById
} from './repositories/segmentsRepo';
import { getCompanionTripId } from './tripCompanions';
import { withTripAction } from './actions';
import { requireEditableTrip } from './ownership';
import { logAudit } from './audit';
import { SEGMENT_ATTENDEE_STATUSES, type SegmentAttendeeStatus } from './db/mongrelSchema';

type AttendeeRow = {
	id: number;
	segmentId: number;
	companionId: number;
	name: string;
	category: 'adult' | 'child' | 'other';
	status: SegmentAttendeeStatus;
};

function validateSegmentAndCompanion(tripId: number, segmentId: number, companionId: number) {
	const seg = getSegmentById(segmentId);
	if (!seg || seg.tripId !== tripId) throw error(404, 'Segment not found');

	const companionTripId = getCompanionTripId(companionId);
	if (companionTripId == null || companionTripId !== tripId) throw error(404, 'Companion not found');
}

export function listAttendeesForSegment(segmentId: number): AttendeeRow[] {
	return listAttendeesForSegmentRepo(segmentId);
}

export function listAttendeesForSegments(segmentIds: number[]): Map<number, AttendeeRow[]> {
	return listAttendeesForSegmentsRepo(segmentIds);
}

export function upsertAttendee(
	userId: number,
	tripId: number,
	segmentId: number,
	companionId: number,
	status: SegmentAttendeeStatus
) {
	requireEditableTrip(userId, tripId);
	validateSegmentAndCompanion(tripId, segmentId, companionId);

	if (!SEGMENT_ATTENDEE_STATUSES.includes(status)) throw error(400, 'Invalid status');

	upsertAttendeeRepo(segmentId, companionId, status);

	logAudit(userId, 'set_attendee_status', 'segment', segmentId, { tripId, companionId, status });
}

export function deleteAttendee(
	userId: number,
	tripId: number,
	segmentId: number,
	companionId: number
) {
	requireEditableTrip(userId, tripId);
	validateSegmentAndCompanion(tripId, segmentId, companionId);

	removeAttendeeBySegmentAndCompanion(segmentId, companionId);

	logAudit(userId, 'remove_attendee', 'segment', segmentId, { tripId, companionId });
}

export async function setAttendee(event: RequestEvent) {
	const { user: u, tripId, formData: f } = await withTripAction(event);
	const segmentId = Number(f.get('segmentId'));
	const companionId = Number(f.get('companionId'));
	const status = String(f.get('status') || '');

	if (!Number.isFinite(segmentId) || segmentId <= 0) throw error(400, 'Invalid segment');
	if (!Number.isFinite(companionId) || companionId <= 0) throw error(400, 'Invalid companion');
	if (!SEGMENT_ATTENDEE_STATUSES.includes(status as SegmentAttendeeStatus)) {
		throw error(400, 'Invalid status');
	}

	upsertAttendee(u.id, tripId, segmentId, companionId, status as SegmentAttendeeStatus);
	throw redirect(303, `/trips/${tripId}`);
}
