import { error } from '@sveltejs/kit';
import { and, eq, ne, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { requireEditableTrip, assertOwnedRefs } from '$lib/server/ownership';
import { localToUtc } from '$lib/server/tz';
import { upsertRemindersForSegment, cancelRemindersFor } from '$lib/server/reminders';
import { logAudit } from '$lib/server/audit';
import { db } from '$lib/server/db';
import { segments, type SegmentType, type SegmentStatus, SEGMENT_STATUSES } from '$lib/server/db/schema';

export function addSegment(
	userId: number,
	tripId: number,
	i: {
		type: SegmentType;
		title: string;
		localStart: string;
		startTz: string;
		endAt?: string;
		endTz?: string;
		location?: string;
		confirmationNumber?: string;
		cardId?: number;
		details?: object;
	}
) {
	requireEditableTrip(userId, tripId);
	if (i.cardId != null) assertOwnedRefs(userId, { cardId: i.cardId });
	const endTz = i.endTz ?? i.startTz;
	const seg = db
		.insert(segments)
		.values({
			tripId,
			type: i.type,
			title: i.title,
			startAt: localToUtc(i.localStart, i.startTz),
			startTz: i.startTz,
			endAt: i.endAt ? localToUtc(i.endAt, endTz) : null,
			endTz,
			location: i.location ?? null,
			confirmationNumber: i.confirmationNumber ?? null,
			cardId: i.cardId ?? null,
			detailsJson: i.details ? JSON.stringify(i.details) : null
		})
		.returning()
		.get();
	upsertRemindersForSegment(seg);
	return seg;
}

export function hasOverlappingSegment(
	tripId: number,
	excludeSegmentId: number | undefined,
	startAt: string,
	endAt: string | null | undefined
) {
	if (!endAt) return false;
	const conditions = [
		eq(segments.tripId, tripId),
		sql`${segments.startAt} < ${endAt}`,
		sql`${segments.endAt} > ${startAt}`
	];
	if (excludeSegmentId != null) conditions.push(ne(segments.id, excludeSegmentId));
	const row = db
		.select({ count: sql<number>`count(*)` })
		.from(segments)
		.where(and(...conditions))
		.get();
	return (row?.count ?? 0) > 0;
}

export function deleteSegment(userId: number, tripId: number, segId: number) {
	requireEditableTrip(userId, tripId);
	db.delete(segments).where(and(eq(segments.id, segId), eq(segments.tripId, tripId))).run();
	cancelRemindersFor('segment', segId);
}

export function updateSegment(
	userId: number,
	tripId: number,
	segId: number,
	i: {
		title: string;
		localStart: string;
		startTz: string;
		endAt?: string;
		endTz?: string;
		location?: string;
		confirmationNumber?: string;
		cardId?: number;
		details?: object;
	}
) {
	requireEditableTrip(userId, tripId);
	const existing = db
		.select()
		.from(segments)
		.where(and(eq(segments.id, segId), eq(segments.tripId, tripId)))
		.get();
	if (!existing) throw error(404, 'Not found');
	if (i.cardId != null) assertOwnedRefs(userId, { cardId: i.cardId });
	const endTz = i.endTz ?? i.startTz;
	const seg = db
		.update(segments)
		.set({
			title: i.title,
			startAt: localToUtc(i.localStart, i.startTz),
			startTz: i.startTz,
			endAt: i.endAt ? localToUtc(i.endAt, endTz) : null,
			endTz,
			location: i.location ?? null,
			confirmationNumber: i.confirmationNumber ?? null,
			cardId: i.cardId ?? null,
			detailsJson: i.details ? JSON.stringify(i.details) : null
		})
		.where(eq(segments.id, segId))
		.returning()
		.get();
	upsertRemindersForSegment(seg);
	return seg;
}

function shiftUtcBy24h(iso: string | null) {
	if (!iso) return null;
	return DateTime.fromISO(iso, { zone: 'utc' }).plus({ hours: 24 }).toUTC().toISO()!;
}

export function duplicateSegment(userId: number, tripId: number, segId: number) {
	requireEditableTrip(userId, tripId);
	const existing = db
		.select()
		.from(segments)
		.where(and(eq(segments.id, segId), eq(segments.tripId, tripId)))
		.get();
	if (!existing) throw error(404, 'Not found');
	if (existing.cardId != null) assertOwnedRefs(userId, { cardId: existing.cardId });

	const copy = db
		.insert(segments)
		.values({
			tripId,
			type: existing.type,
			title: existing.title,
			startAt: shiftUtcBy24h(existing.startAt)!,
			startTz: existing.startTz,
			endAt: shiftUtcBy24h(existing.endAt),
			endTz: existing.endTz ?? existing.startTz,
			location: existing.location,
			confirmationNumber: null,
			cardId: existing.cardId,
			detailsJson: existing.detailsJson
		})
		.returning()
		.get();
	upsertRemindersForSegment(copy);
	logAudit(userId, 'duplicate', 'segment', copy.id, { sourceSegmentId: segId, sourceTripId: tripId });
	return copy;
}

export function updateSegmentStatus(segmentId: number, status: SegmentStatus) {
	if (!SEGMENT_STATUSES.includes(status)) {
		throw error(400, 'Invalid segment status');
	}
	return db
		.update(segments)
		.set({ status, updatedAt: DateTime.utc().toISO() })
		.where(eq(segments.id, segmentId))
		.returning()
		.get();
}

export function setSegmentStatus(
	userId: number,
	tripId: number,
	segmentId: number,
	status: SegmentStatus
) {
	requireEditableTrip(userId, tripId);
	const existing = db
		.select({ id: segments.id })
		.from(segments)
		.where(and(eq(segments.id, segmentId), eq(segments.tripId, tripId)))
		.get();
	if (!existing) throw error(404, 'Not found');
	const seg = updateSegmentStatus(segmentId, status);
	logAudit(userId, 'update_status', 'segment', segmentId, { status });
	return seg;
}
