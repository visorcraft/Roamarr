import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from './db';
import {
	segmentAttendees,
	segments,
	tripCompanions,
	SEGMENT_ATTENDEE_STATUSES,
	type SegmentAttendeeStatus,
	type CompanionCategory
} from './db/schema';
import { withTripAction } from './actions';
import { requireEditableTrip } from './ownership';
import { logAudit } from './audit';

export type AttendeeRow = {
	id: number;
	segmentId: number;
	companionId: number;
	name: string;
	category: 'adult' | 'child' | 'other';
	status: SegmentAttendeeStatus;
};

function validateSegmentAndCompanion(tripId: number, segmentId: number, companionId: number) {
	const seg = db
		.select({ tripId: segments.tripId })
		.from(segments)
		.where(eq(segments.id, segmentId))
		.get();
	if (!seg || seg.tripId !== tripId) throw error(404, 'Segment not found');

	const companion = db
		.select({ tripId: tripCompanions.tripId })
		.from(tripCompanions)
		.where(eq(tripCompanions.id, companionId))
		.get();
	if (!companion || companion.tripId !== tripId) throw error(404, 'Companion not found');
}

export function listAttendeesForSegment(segmentId: number): AttendeeRow[] {
	return db
		.select({
			id: segmentAttendees.id,
			segmentId: segmentAttendees.segmentId,
			companionId: segmentAttendees.companionId,
			name: tripCompanions.name,
			category: tripCompanions.category,
			status: segmentAttendees.status
		})
		.from(segmentAttendees)
		.innerJoin(tripCompanions, eq(segmentAttendees.companionId, tripCompanions.id))
		.where(eq(segmentAttendees.segmentId, segmentId))
		.orderBy(tripCompanions.name)
		.all()
		.map((row) => ({
			...row,
			category: row.category as CompanionCategory,
			status: row.status as SegmentAttendeeStatus
		}));
}

export function listAttendeesForSegments(segmentIds: number[]): Map<number, AttendeeRow[]> {
	const map = new Map<number, AttendeeRow[]>();
	for (const id of segmentIds) map.set(id, []);
	if (segmentIds.length === 0) return map;

	const rows = db
		.select({
			id: segmentAttendees.id,
			segmentId: segmentAttendees.segmentId,
			companionId: segmentAttendees.companionId,
			name: tripCompanions.name,
			category: tripCompanions.category,
			status: segmentAttendees.status
		})
		.from(segmentAttendees)
		.innerJoin(tripCompanions, eq(segmentAttendees.companionId, tripCompanions.id))
		.where(inArray(segmentAttendees.segmentId, segmentIds))
		.orderBy(tripCompanions.name)
		.all();

	for (const row of rows) {
		map.get(row.segmentId)!.push({
			...row,
			category: row.category as CompanionCategory,
			status: row.status as SegmentAttendeeStatus
		});
	}
	return map;
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

	db.insert(segmentAttendees)
		.values({ segmentId, companionId, status })
		.onConflictDoUpdate({
			target: [segmentAttendees.segmentId, segmentAttendees.companionId],
			set: { status }
		})
		.run();

	logAudit(userId, 'set_attendee_status', 'segment', segmentId, { companionId, status });
}

export function deleteAttendee(
	userId: number,
	tripId: number,
	segmentId: number,
	companionId: number
) {
	requireEditableTrip(userId, tripId);
	validateSegmentAndCompanion(tripId, segmentId, companionId);

	db.delete(segmentAttendees)
		.where(and(eq(segmentAttendees.segmentId, segmentId), eq(segmentAttendees.companionId, companionId)))
		.run();

	logAudit(userId, 'remove_attendee', 'segment', segmentId, { companionId });
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
