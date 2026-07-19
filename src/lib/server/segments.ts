import { error } from '@sveltejs/kit';
import { DateTime } from 'luxon';
import { requireEditableTrip, assertOwnedRefs } from '$lib/server/ownership';
import { localToUtc, nowIso } from '$lib/server/tz';
import { upsertRemindersForSegment, cancelRemindersFor } from '$lib/server/reminders';
import { logAudit } from '$lib/server/audit';
import {
	createSegment,
	updateSegment as updateSegmentRepo,
	deleteSegment as deleteSegmentRepo,
	deleteSegmentsForTrip,
	getSegmentById,
	countOverlappingSegments
} from '$lib/server/repositories/segmentsRepo';
import { SEGMENT_STATUSES, SEGMENT_PAYMENT_STATUSES, type SegmentType, type SegmentStatus } from '$lib/server/db/mongrelSchema';

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

function requireSegmentOnTrip(userId: number, tripId: number, segId: number) {
	requireEditableTrip(userId, tripId);
	const existing = getSegmentById(segId);
	if (!existing || existing.tripId !== tripId) throw error(404, 'Not found');
	return existing;
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
	const seg = createSegment({
		trip_id: BigInt(tripId),
		type: i.type,
		title: i.title,
		start_at: localToUtc(i.localStart, i.startTz),
		start_tz: i.startTz,
		end_at: i.endAt ? localToUtc(i.endAt, endTz) : null,
		end_tz: endTz,
		location: i.location ?? null,
		country_code: i.countryCode ?? null,
		city_name: i.cityName ?? null,
		city_lat: i.cityLat ?? null,
		city_lng: i.cityLng ?? null,
		venue: i.venue ?? null,
		confirmation_number: i.confirmationNumber ?? null,
		card_id: i.cardId != null ? BigInt(i.cardId) : null,
		details_json: i.details ? JSON.stringify(i.details) : null,
		meeting_point: meetingPoint,
		meeting_at: meetingAt,
		payment_status: paymentStatus,
		payment_due_date: i.paymentDueDate ?? null
	});
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
	const count = countOverlappingSegments(tripId, startAt, endAt, excludeSegmentId);
	return count > 0n;
}

export function deleteSegment(userId: number, tripId: number, segId: number) {
	requireSegmentOnTrip(userId, tripId, segId);
	deleteSegmentRepo(segId);
	cancelRemindersFor('segment', segId);
}

export function deleteSegments(userId: number, tripId: number, segIds: number[]) {
	requireEditableTrip(userId, tripId);
	const unique = Array.from(new Set(segIds.filter((id) => Number.isInteger(id) && id > 0)));
	if (unique.length === 0) return 0;
	deleteSegmentsForTrip(tripId, unique);
	for (const id of unique) {
		cancelRemindersFor('segment', id);
	}
	logAudit(userId, 'delete_many', 'segment', tripId, { count: unique.length });
	return unique.length;
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
	requireSegmentOnTrip(userId, tripId, segId);
	if (i.cardId != null) assertOwnedRefs(userId, { cardId: i.cardId });
	const endTz = i.endTz ?? i.startTz;
	const { meetingPoint, meetingAt } = normalizeMeetingAt(i);
	const paymentStatus = i.paymentStatus ? normalizePaymentStatus(i.paymentStatus) : undefined;
	const patch: Parameters<typeof updateSegmentRepo>[1] = {
		title: i.title,
		start_at: localToUtc(i.localStart, i.startTz),
		start_tz: i.startTz,
		end_at: i.endAt ? localToUtc(i.endAt, endTz) : null,
		end_tz: endTz,
		location: i.location ?? null,
		country_code: i.countryCode ?? null,
		city_name: i.cityName ?? null,
		city_lat: i.cityLat ?? null,
		city_lng: i.cityLng ?? null,
		venue: i.venue ?? null,
		confirmation_number: i.confirmationNumber ?? null,
		card_id: i.cardId != null ? BigInt(i.cardId) : null,
		details_json: i.details ? JSON.stringify(i.details) : null,
		meeting_point: meetingPoint,
		meeting_at: meetingAt,
		payment_due_date: i.paymentDueDate
	};
	if (paymentStatus) {
		patch.payment_status = paymentStatus;
	}
	const seg = updateSegmentRepo(segId, patch);
	if (!seg) throw error(404, 'Not found');
	upsertRemindersForSegment(seg);
	return seg;
}

export function moveSegmentToDate(userId: number, tripId: number, segId: number, targetDate: string) {
	const existing = requireSegmentOnTrip(userId, tripId, segId);
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

	const seg = updateSegmentRepo(segId, {
		start_at: movedStart.toISO()!,
		end_at: movedEndAt,
		meeting_at: movedMeetingAt,
		updated_at: nowIso()
	});
	if (!seg) throw error(404, 'Not found');
	upsertRemindersForSegment(seg);
	logAudit(userId, 'move_date', 'segment', segId, { tripId, targetDate });
	return seg;
}

export function duplicateSegment(userId: number, tripId: number, segId: number) {
	const existing = requireSegmentOnTrip(userId, tripId, segId);
	if (existing.cardId != null) assertOwnedRefs(userId, { cardId: existing.cardId });

	const copy = createSegment({
		trip_id: BigInt(tripId),
		type: existing.type,
		title: existing.title,
		start_at: existing.startAt,
		start_tz: existing.startTz,
		end_at: existing.endAt,
		end_tz: existing.endTz ?? existing.startTz,
		location: existing.location,
		country_code: existing.countryCode,
		city_name: existing.cityName,
		city_lat: existing.cityLat,
		city_lng: existing.cityLng,
		venue: existing.venue,
		confirmation_number: null,
		card_id: existing.cardId != null ? BigInt(existing.cardId) : null,
		details_json: existing.detailsJson,
		meeting_point: existing.meetingPoint,
		meeting_at: existing.meetingAt,
		payment_status: existing.paymentStatus,
		payment_due_date: existing.paymentDueDate
	});
	upsertRemindersForSegment(copy);
	logAudit(userId, 'duplicate', 'segment', copy.id, { tripId, sourceSegmentId: segId, sourceTripId: tripId });
	return copy;
}

export function updateSegmentStatus(segmentId: number, status: SegmentStatus) {
	if (!SEGMENT_STATUSES.includes(status)) {
		throw error(400, 'Invalid segment status');
	}
	const seg = updateSegmentRepo(segmentId, { status, updated_at: nowIso() });
	if (!seg) throw error(404, 'Not found');
	return seg;
}

// Partial segment update for MCP clients. Only the user-facing fields are
// accepted: user-facing itinerary fields only. Internal fields
// (status, type, trip_id, etc.) are not exposed.
export function patchSegment(
	userId: number,
	segId: number,
	patch: {
		type?: SegmentType;
		title?: string;
		startAt?: string;
		endAt?: string | null;
		cityName?: string | null;
		countryCode?: string | null;
		location?: string | null;
		confirmationNumber?: string | null;
		notes?: string;
		details?: Record<string, unknown>;
		paymentStatus?: string;
	}
) {
	// Resolve segment first to get tripId; ownership check follows.
	const seg = getSegmentById(segId);
	if (!seg) throw error(404, 'Segment not found');
	const verified = requireSegmentOnTrip(userId, seg.tripId, segId);
	const repoPatch: Record<string, unknown> = { updated_at: nowIso() };
	if (patch.type !== undefined) repoPatch.type = patch.type;
	if (patch.title !== undefined) repoPatch.title = patch.title;
	if (patch.startAt !== undefined) {
		repoPatch.start_at = patch.startAt;
		// Treat incoming ISO as UTC; preserves prior tz column untouched.
	}
	if (patch.endAt !== undefined) repoPatch.end_at = patch.endAt;
	if (patch.cityName !== undefined) repoPatch.city_name = patch.cityName;
	if (patch.countryCode !== undefined) repoPatch.country_code = patch.countryCode;
	if (patch.location !== undefined) repoPatch.location = patch.location;
	if (patch.confirmationNumber !== undefined) repoPatch.confirmation_number = patch.confirmationNumber;
	if (patch.details !== undefined || patch.notes !== undefined) {
		let details: Record<string, unknown> = {};
		try {
			details = seg.detailsJson ? JSON.parse(seg.detailsJson) : {};
		} catch {
			// Replace invalid legacy JSON with valid details.
		}
		repoPatch.details_json = JSON.stringify({
			...details,
			...(patch.details ?? {}),
			...(patch.notes !== undefined ? { notes: patch.notes } : {})
		});
	}
	if (patch.paymentStatus !== undefined) repoPatch.payment_status = normalizePaymentStatus(patch.paymentStatus);
	const updated = updateSegmentRepo(verified.id, repoPatch);
	if (!updated) throw error(404, 'Segment not found');
	// Refresh reminders so flight_checkin arms against the new startAt
	// (or the segment is un-armed if the type changed implicitly). Done
	// after the update to ensure the patch is committed.
	upsertRemindersForSegment(updated);
	return updated;
}

export function setSegmentStatus(
	userId: number,
	tripId: number,
	segmentId: number,
	status: SegmentStatus
) {
	requireSegmentOnTrip(userId, tripId, segmentId);
	const seg = updateSegmentStatus(segmentId, status);
	logAudit(userId, 'update_status', 'segment', segmentId, { tripId, status });
	return seg;
}
