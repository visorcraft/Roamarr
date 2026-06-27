import { error } from '@sveltejs/kit';
import { and, eq, ne, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { requireEditableTrip, assertOwnedRefs } from '$lib/server/ownership';
import { localToUtc, nowIso } from '$lib/server/tz';
import { upsertRemindersForSegment, cancelRemindersFor } from '$lib/server/reminders';
import { logAudit } from '$lib/server/audit';
import { db } from '$lib/server/db';
import {
	segments,
	type SegmentType,
	type SegmentStatus,
	SEGMENT_STATUSES,
	SEGMENT_PAYMENT_STATUSES
} from '$lib/server/db/schema';

function normalizeMeetingAt(i: {
	meetingAt?: string;
	meetingPoint?: string;
	startTz?: string;
	endTz?: string;
}): { meetingPoint: string | null; meetingAt: string | null } {
	const meetingPoint = i.meetingPoint?.trim() ? i.meetingPoint.trim().slice(0, 200) : null;
	if (!i.meetingAt?.trim()) return { meetingPoint, meetingAt: null };
	const tz = i.startTz ?? 'UTC';
	return { meetingPoint, meetingAt: localToUtc(i.meetingAt, tz) };
}

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
		countryCode?: string;
		cityName?: string;
		cityLat?: number;
		cityLng?: number;
		venue?: string;
		confirmationNumber?: string;
		cardId?: number;
		details?: object;
		meetingPoint?: string;
		meetingAt?: string;
		paymentStatus?: string;
		paymentDueDate?: string | null;
	}
) {
	requireEditableTrip(userId, tripId);
	if (i.cardId != null) assertOwnedRefs(userId, { cardId: i.cardId });
	const endTz = i.endTz ?? i.startTz;
	const { meetingPoint, meetingAt } = normalizeMeetingAt(i);
	const paymentStatus = normalizePaymentStatus(i.paymentStatus);
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
			countryCode: i.countryCode ?? null,
			cityName: i.cityName ?? null,
			cityLat: i.cityLat ?? null,
			cityLng: i.cityLng ?? null,
			venue: i.venue ?? null,
			confirmationNumber: i.confirmationNumber ?? null,
			cardId: i.cardId ?? null,
			detailsJson: i.details ? JSON.stringify(i.details) : null,
			meetingPoint,
			meetingAt,
			paymentStatus,
			paymentDueDate: i.paymentDueDate ?? null
		})
		.returning()
		.get();
	upsertRemindersForSegment(seg);
	return seg;
}

function normalizePaymentStatus(raw?: string | null): string {
	if (!raw) return 'quoted';
	const s = raw.trim();
	if (!SEGMENT_PAYMENT_STATUSES.includes(s as (typeof SEGMENT_PAYMENT_STATUSES)[number])) {
		throw error(400, `Invalid payment status: ${s}`);
	}
	return s;
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

export function deleteSegments(userId: number, tripId: number, segIds: number[]) {
	requireEditableTrip(userId, tripId);
	const unique = Array.from(new Set(segIds.filter((id) => Number.isInteger(id) && id > 0)));
	if (unique.length === 0) return 0;
	const deleted = db
		.delete(segments)
		.where(and(eq(segments.tripId, tripId), sql`${segments.id} IN (${sql.join(unique, sql`, `)})`))
		.run();
	for (const id of unique) {
		cancelRemindersFor('segment', id);
	}
	logAudit(userId, 'delete_many', 'segment', tripId, { count: unique.length });
	return deleted.changes ?? unique.length;
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
		countryCode?: string;
		cityName?: string;
		cityLat?: number;
		cityLng?: number;
		venue?: string;
		confirmationNumber?: string;
		cardId?: number;
		details?: object;
		meetingPoint?: string;
		meetingAt?: string;
		paymentStatus?: string;
		paymentDueDate?: string | null;
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
	const { meetingPoint, meetingAt } = normalizeMeetingAt(i);
	const paymentStatus = i.paymentStatus ? normalizePaymentStatus(i.paymentStatus) : undefined;
	const seg = db
		.update(segments)
		.set({
			title: i.title,
			startAt: localToUtc(i.localStart, i.startTz),
			startTz: i.startTz,
			endAt: i.endAt ? localToUtc(i.endAt, endTz) : null,
			endTz,
			location: i.location ?? null,
			countryCode: i.countryCode ?? null,
			cityName: i.cityName ?? null,
			cityLat: i.cityLat ?? null,
			cityLng: i.cityLng ?? null,
			venue: i.venue ?? null,
			confirmationNumber: i.confirmationNumber ?? null,
			cardId: i.cardId ?? null,
			detailsJson: i.details ? JSON.stringify(i.details) : null,
			meetingPoint,
			meetingAt,
			...(paymentStatus && { paymentStatus }),
			paymentDueDate: i.paymentDueDate
		})
		.where(eq(segments.id, segId))
		.returning()
		.get();
	upsertRemindersForSegment(seg);
	return seg;
}

export function moveSegmentToDate(userId: number, tripId: number, segId: number, targetDate: string) {
	requireEditableTrip(userId, tripId);
	const existing = db
		.select()
		.from(segments)
		.where(and(eq(segments.id, segId), eq(segments.tripId, tripId)))
		.get();
	if (!existing) throw error(404, 'Not found');

	const start = DateTime.fromISO(existing.startAt, { zone: 'utc' });
	const startLocal = start.setZone(existing.startTz || 'UTC');
	const targetLocalDate = DateTime.fromISO(targetDate, { zone: existing.startTz || 'UTC' });
	if (!start.isValid || !startLocal.isValid || !targetLocalDate.isValid) {
		throw error(400, 'Invalid segment date');
	}

	const movedStart = targetLocalDate
		.set({
			hour: startLocal.hour,
			minute: startLocal.minute,
			second: startLocal.second,
			millisecond: startLocal.millisecond
		})
		.toUTC();
	const delta = movedStart.diff(start);
	const movedEndAt = existing.endAt
		? DateTime.fromISO(existing.endAt, { zone: 'utc' }).plus(delta).toUTC().toISO()
		: null;
	const movedMeetingAt = existing.meetingAt
		? DateTime.fromISO(existing.meetingAt, { zone: 'utc' }).plus(delta).toUTC().toISO()
		: null;

	const seg = db
		.update(segments)
		.set({
			startAt: movedStart.toISO()!,
			endAt: movedEndAt,
			meetingAt: movedMeetingAt,
			updatedAt: nowIso()
		})
		.where(eq(segments.id, segId))
		.returning()
		.get();
	upsertRemindersForSegment(seg);
	logAudit(userId, 'move_date', 'segment', segId, { targetDate });
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
			countryCode: existing.countryCode,
			cityName: existing.cityName,
			cityLat: existing.cityLat,
			cityLng: existing.cityLng,
			venue: existing.venue,
			confirmationNumber: null,
			cardId: existing.cardId,
			detailsJson: existing.detailsJson,
			meetingPoint: existing.meetingPoint,
			meetingAt: shiftUtcBy24h(existing.meetingAt),
			paymentStatus: existing.paymentStatus,
			paymentDueDate: existing.paymentDueDate
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
		.set({ status, updatedAt: nowIso() })
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
