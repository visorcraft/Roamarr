import { error } from '@sveltejs/kit';
import { DateTime } from 'luxon';
import { requireEditableTrip, assertOwnedRefs, ownedCardId } from '$lib/server/ownership';
import { canViewDetails } from '$lib/server/sharing';
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
import { findCity } from '$lib/server/cities';

function assertEndNotBeforeStart(startAtUtc: string, endAtUtc: string | null | undefined): void {
	if (!endAtUtc) return;
	const start = DateTime.fromISO(startAtUtc, { zone: 'utc' });
	const end = DateTime.fromISO(endAtUtc, { zone: 'utc' });
	if (!start.isValid || !end.isValid) return;
	if (end.toMillis() < start.toMillis()) {
		throw error(400, 'End time must not be before the start time');
	}
}

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
		admin1Code?: string;
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
	const startAtUtc = localToUtc(i.localStart, i.startTz);
	const endAtUtc = i.endAt ? localToUtc(i.endAt, endTz) : null;
	assertEndNotBeforeStart(startAtUtc, endAtUtc);
	const { meetingPoint, meetingAt } = normalizeMeetingAt(i);
	const paymentStatus = normalizePaymentStatus(i.paymentStatus);
	const seg = createSegment({
		trip_id: BigInt(tripId),
		type: i.type,
		title: i.title,
		start_at: startAtUtc,
		start_tz: i.startTz,
		end_at: endAtUtc,
		end_tz: endTz,
		location: i.location ?? null,
		country_code: i.countryCode ?? null,
		admin1_code: i.admin1Code ?? null,
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
		admin1Code?: string;
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
	const trip = requireEditableTrip(userId, tripId);
	const existing = getSegmentById(segId);
	if (!existing || existing.tripId !== tripId) throw error(404, 'Not found');
	if (i.cardId != null) assertOwnedRefs(userId, { cardId: i.cardId });
	const isOwner = trip.ownerId === userId;
	const endTz = i.endTz ?? i.startTz;
	const { meetingPoint, meetingAt } = normalizeMeetingAt(i);
	const paymentStatus = i.paymentStatus ? normalizePaymentStatus(i.paymentStatus) : undefined;
	// Editors without details must not blank out stored confirmation/details.
	// Shared editors can only reference their own cards, so a blank cardId means
	// "none of mine": only the trip owner may clear or replace the stored card.
	const showDetails = canViewDetails(userId, trip);
	const patch: Parameters<typeof updateSegmentRepo>[1] = {
		title: i.title,
		start_at: localToUtc(i.localStart, i.startTz),
		start_tz: i.startTz,
		end_at: i.endAt ? localToUtc(i.endAt, endTz) : null,
		end_tz: endTz,
		location: i.location ?? null,
		country_code: i.countryCode ?? null,
		admin1_code: i.admin1Code ?? null,
		city_name: i.cityName ?? null,
		city_lat: i.cityLat ?? null,
		city_lng: i.cityLng ?? null,
		venue: i.venue ?? null,
		confirmation_number: showDetails ? (i.confirmationNumber ?? null) : existing.confirmationNumber,
		card_id: i.cardId != null ? BigInt(i.cardId) : isOwner ? null : existing.cardId != null ? BigInt(existing.cardId) : null,
		details_json: showDetails ? (i.details ? JSON.stringify(i.details) : null) : existing.detailsJson,
		meeting_point: meetingPoint,
		meeting_at: meetingAt,
		payment_due_date: i.paymentDueDate
	};
	if (paymentStatus) {
		patch.payment_status = paymentStatus;
	}
	assertEndNotBeforeStart(patch.start_at as string, patch.end_at);
	const seg = updateSegmentRepo(segId, patch);
	if (!seg) throw error(404, 'Not found');
	upsertRemindersForSegment(seg);
	return seg;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function moveSegmentToDate(userId: number, tripId: number, segId: number, targetDate: string) {
	const existing = requireSegmentOnTrip(userId, tripId, segId);
	if (!DATE_ONLY_PATTERN.test(targetDate)) throw error(400, 'Invalid segment date');
	const start = DateTime.fromISO(existing.startAt, { zone: 'utc' });
	const startLocal = start.setZone(existing.startTz || 'UTC');
	const targetLocalDate = DateTime.fromISO(targetDate, { zone: existing.startTz || 'UTC' });
	if (!start.isValid || !startLocal.isValid || !targetLocalDate.isValid) {
		throw error(400, 'Invalid segment date');
	}
	const endParsed = existing.endAt ? DateTime.fromISO(existing.endAt, { zone: 'utc' }) : null;
	const meetingParsed = existing.meetingAt ? DateTime.fromISO(existing.meetingAt, { zone: 'utc' }) : null;
	if ((endParsed && !endParsed.isValid) || (meetingParsed && !meetingParsed.isValid)) {
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
	const movedStartIso = movedStart.toISO();
	if (!movedStart.isValid || !movedStartIso) throw error(400, 'Invalid segment date');
	const delta = movedStart.diff(start);
	const movedEndAt = endParsed ? endParsed.plus(delta).toUTC().toISO() : null;
	const movedMeetingAt = meetingParsed ? meetingParsed.plus(delta).toUTC().toISO() : null;

	const seg = updateSegmentRepo(segId, {
		start_at: movedStartIso,
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
	// The stored card is not caller-supplied, so this is not assertOwnedRefs
	// territory: an editor may duplicate a segment paid with the owner's card
	// (and vice versa). The copy keeps the card only when the caller owns it,
	// because shared editors can reference nothing but their own cards.
	const cardId = existing.cardId != null ? ownedCardId(userId, existing.cardId) : null;

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
		admin1_code: existing.admin1Code,
		city_name: existing.cityName,
		city_lat: existing.cityLat,
		city_lng: existing.cityLng,
		venue: existing.venue,
		confirmation_number: null,
		card_id: cardId != null ? BigInt(cardId) : null,
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
		startTz?: string;
		endAt?: string | null;
		endTz?: string;
		cityName?: string | null;
		countryCode?: string | null;
		admin1Code?: string | null;
		cityLat?: number | null;
		cityLng?: number | null;
		location?: string | null;
		venue?: string | null;
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
	// Same rule as updateSegment and the MCP trip-notes guard: an editor whose
	// share lacks showDetails can neither see nor replace the owner's private
	// confirmation number, details, or notes.
	const touchesPrivateFields =
		patch.confirmationNumber !== undefined || patch.details !== undefined || patch.notes !== undefined;
	if (touchesPrivateFields && !canViewDetails(userId, requireEditableTrip(userId, seg.tripId))) {
		throw error(403, 'confirmationNumber, details, and notes cannot be changed without permission to view private trip details; omit them and retry');
	}
	const repoPatch: Record<string, unknown> = { updated_at: nowIso() };
	if (patch.type !== undefined) repoPatch.type = patch.type;
	if (patch.title !== undefined) repoPatch.title = patch.title;
	if (patch.startAt !== undefined) {
		repoPatch.start_at = patch.startTz ? localToUtc(patch.startAt, patch.startTz) : patch.startAt;
	}
	if (patch.startTz !== undefined) repoPatch.start_tz = patch.startTz;
	if (patch.endAt !== undefined) {
		const endTz = patch.endTz ?? patch.startTz;
		repoPatch.end_at = patch.endAt && endTz ? localToUtc(patch.endAt, endTz) : patch.endAt;
	}
	if (patch.endTz !== undefined) repoPatch.end_tz = patch.endTz;
	// Resolve city name → coords when location fields change. Explicit cityLat/lng
	// (dropdown) win; otherwise re-look up highest-pop match in country/admin1.
	if (
		patch.cityName !== undefined ||
		patch.countryCode !== undefined ||
		patch.admin1Code !== undefined ||
		patch.cityLat !== undefined ||
		patch.cityLng !== undefined
	) {
		const country = patch.countryCode !== undefined ? patch.countryCode : verified.countryCode;
		const cityName = patch.cityName !== undefined ? patch.cityName : verified.cityName;
		const admin1 = patch.admin1Code !== undefined ? patch.admin1Code : verified.admin1Code;
		const locationChanged =
			patch.cityName !== undefined ||
			patch.countryCode !== undefined ||
			patch.admin1Code !== undefined;
		// Drop prior coords when re-targeting country/admin1/name without new lat/lng
		const lat =
			patch.cityLat !== undefined
				? patch.cityLat
				: locationChanged
					? null
					: verified.cityLat;
		const lng =
			patch.cityLng !== undefined
				? patch.cityLng
				: locationChanged
					? null
					: verified.cityLng;
		if (country && cityName) {
			const city = findCity(country, cityName, admin1);
			const hasCoords = lat != null && lng != null;
			repoPatch.country_code = country;
			repoPatch.admin1_code = admin1 ?? city?.admin1Code ?? null;
			repoPatch.city_name = city?.name ?? cityName;
			repoPatch.city_lat = hasCoords ? lat : (city?.lat ?? null);
			repoPatch.city_lng = hasCoords ? lng : (city?.lng ?? null);
		} else {
			if (patch.cityName !== undefined) repoPatch.city_name = patch.cityName;
			if (patch.countryCode !== undefined) repoPatch.country_code = patch.countryCode;
			if (patch.admin1Code !== undefined) repoPatch.admin1_code = patch.admin1Code;
			if (patch.cityLat !== undefined) repoPatch.city_lat = patch.cityLat;
			if (patch.cityLng !== undefined) repoPatch.city_lng = patch.cityLng;
		}
	}
	if (patch.location !== undefined) repoPatch.location = patch.location;
	if (patch.venue !== undefined) repoPatch.venue = patch.venue;
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
	if (patch.startAt !== undefined || patch.endAt !== undefined) {
		const effectiveStart = repoPatch.start_at !== undefined ? repoPatch.start_at : verified.startAt;
		const effectiveEnd = patch.endAt !== undefined ? repoPatch.end_at : verified.endAt;
		assertEndNotBeforeStart(effectiveStart as string, effectiveEnd as string | null | undefined);
	}
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
