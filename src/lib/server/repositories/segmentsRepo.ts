import { eq as kitEq, and as kitAnd, ne as kitNe, lt as kitLt, gt as kitGt, inList as kitInList, asc as kitAsc } from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import { segments, segmentAttendees, tripCompanions } from '$lib/server/db/mongrelSchema';
import type { Row, Insert, Update } from '@visorcraft/mongreldb-kit';
import type { SegmentType, SegmentStatus, SegmentAttendeeStatus } from '$lib/server/db/mongrelSchema';

export type KitSegment = Row<typeof segments>;
export type KitSegmentAttendee = Row<typeof segmentAttendees>;
type RequiredSegmentFields = 'trip_id' | 'type' | 'title' | 'start_at';
export type CreateSegmentInput = Pick<Row<typeof segments>, RequiredSegmentFields> &
	Partial<Omit<Row<typeof segments>, 'id' | 'created_at' | 'updated_at' | RequiredSegmentFields>>;
export type UpdateSegmentInput = Update<typeof segments>;

export type CreateAttendeeInput = Pick<Row<typeof segmentAttendees>, 'segment_id' | 'companion_id'> &
	Partial<Omit<Row<typeof segmentAttendees>, 'id' | 'created_at' | 'segment_id' | 'companion_id'>>;

export type AttendeeWithCompanion = {
	id: number;
	segmentId: number;
	companionId: number;
	name: string;
	category: 'adult' | 'child' | 'other';
	status: SegmentAttendeeStatus;
};

function toBigInt(id: number): bigint {
	return BigInt(id);
}

function numberOrNull(id: bigint | null | undefined): number | null {
	return id == null ? null : Number(id);
}

function nullableIntToNumber(id: bigint | null | undefined): number | null {
	if (id == null || id === 0n) return null;
	return Number(id);
}

function serializeDetailsJson(value: unknown): string | null {
	if (value == null) return null;
	if (typeof value === 'string') return value;
	return JSON.stringify(value);
}

export function toSegmentRow(row: KitSegment) {
	return {
		id: Number(row.id),
		tripId: Number(row.trip_id),
		type: row.type as SegmentType,
		title: row.title,
		startAt: row.start_at,
		startTz: row.start_tz,
		endAt: row.end_at,
		endTz: row.end_tz,
		status: row.status as SegmentStatus,
		location: row.location,
		countryCode: row.country_code,
		cityName: row.city_name,
		cityLat: row.city_lat,
		cityLng: row.city_lng,
		venue: row.venue,
		confirmationNumber: row.confirmation_number,
		detailsJson: serializeDetailsJson(row.details_json),
		meetingPoint: row.meeting_point,
		meetingAt: row.meeting_at,
		paymentStatus: row.payment_status,
		paymentDueDate: row.payment_due_date,
		cardId: nullableIntToNumber(row.card_id),
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function toAttendeeRow(row: KitSegmentAttendee) {
	return {
		id: Number(row.id),
		segmentId: Number(row.segment_id),
		companionId: Number(row.companion_id),
		status: row.status as SegmentAttendeeStatus,
		createdAt: row.created_at
	};
}

export function countSegments(): bigint {
	return kit.selectFrom(segments).selectCount().executeSync();
}

export function listSegmentsForTrip(tripId: number) {
	return listSegmentsForTrips([tripId]);
}

export function listSegmentsForTrips(tripIds: number[]) {
	if (tripIds.length === 0) return [];
	return kit
		.selectFrom(segments)
		.where(kitInList(segments.trip_id, tripIds.map(toBigInt)))
		.orderBy(kitAsc(segments.start_at))
		.executeSync()
		.map(toSegmentRow);
}

export function getSegmentById(id: number) {
	const rows = kit.selectFrom(segments).where(kitEq(segments.id, toBigInt(id))).executeSync();
	return rows[0] ? toSegmentRow(rows[0]) : null;
}

export function getSegmentsByIds(ids: number[]) {
	if (ids.length === 0) return [];
	return kit
		.selectFrom(segments)
		.where(kitInList(segments.id, ids.map(toBigInt)))
		.executeSync()
		.map(toSegmentRow);
}

export function createSegment(input: CreateSegmentInput) {
	const created = kit.insertInto(segments).values(input as Insert<typeof segments>).executeSync();
	return toSegmentRow(created);
}

export function updateSegment(id: number, patch: UpdateSegmentInput) {
	const existing = kit.selectFrom(segments).where(kitEq(segments.id, toBigInt(id))).executeSync()[0];
	if (!existing) return null;
	const merged: Update<typeof segments> = { ...existing, ...patch, id: existing.id };
	if (merged.card_id === 0n) merged.card_id = null;
	const updated = kit.updateTable(segments).set(merged).where(kitEq(segments.id, toBigInt(id))).executeSync();
	const row = updated[0];
	if (!row) return null;
	return toSegmentRow(row);
}

export function deleteSegment(id: number): boolean {
	const deleted = kit.deleteFrom(segments).where(kitEq(segments.id, toBigInt(id))).executeSync();
	return deleted > 0n;
}

export function deleteSegmentsForTrip(tripId: number, ids?: number[]): bigint {
	if (ids && ids.length === 0) return 0n;
	const predicate = ids?.length
		? kitAnd(kitEq(segments.trip_id, toBigInt(tripId)), kitInList(segments.id, ids.map(toBigInt)))
		: kitEq(segments.trip_id, toBigInt(tripId));
	return kit.deleteFrom(segments).where(predicate).executeSync();
}

export function countOverlappingSegments(
	tripId: number,
	startAt: string,
	endAt: string,
	excludeSegmentId?: number
): bigint {
	const predicates = [
		kitEq(segments.trip_id, toBigInt(tripId)),
		kitLt(segments.start_at, endAt),
		kitGt(segments.end_at, startAt)
	];
	if (excludeSegmentId != null) {
		predicates.push(kitNe(segments.id, toBigInt(excludeSegmentId)));
	}
	return BigInt(kit.selectFrom(segments).where(kitAnd(...predicates)).executeSync().length);
}

export function listAttendeesForSegment(segmentId: number): AttendeeWithCompanion[] {
	const rows = kit
		.selectFrom(segmentAttendees)
		.where(kitEq(segmentAttendees.segment_id, toBigInt(segmentId)))
		.orderBy(kitAsc(segmentAttendees.companion_id))
		.executeSync()
		.map(toAttendeeRow);
	return hydrateAttendeesWithCompanions(rows);
}

export function listAttendeesForSegments(segmentIds: number[]): Map<number, AttendeeWithCompanion[]> {
	const map = new Map<number, AttendeeWithCompanion[]>();
	for (const id of segmentIds) map.set(id, []);
	if (segmentIds.length === 0) return map;

	const rows = kit
		.selectFrom(segmentAttendees)
		.where(kitInList(segmentAttendees.segment_id, segmentIds.map(toBigInt)))
		.orderBy(kitAsc(segmentAttendees.companion_id))
		.executeSync()
		.map(toAttendeeRow);

	const hydrated = hydrateAttendeesWithCompanions(rows);
	for (const a of hydrated) {
		map.get(a.segmentId)?.push(a);
	}
	return map;
}

function hydrateAttendeesWithCompanions(rows: ReturnType<typeof toAttendeeRow>[]): AttendeeWithCompanion[] {
	if (rows.length === 0) return [];
	const companionIds = Array.from(new Set(rows.map((r) => r.companionId)));
	const companionMap = new Map<number, { name: string; category: string }>();
	for (const id of companionIds) {
		const c = getCompanionById(id);
		if (c) companionMap.set(id, c);
	}

	return rows.map((r) => {
		const c = companionMap.get(r.companionId);
		return {
			id: r.id,
			segmentId: r.segmentId,
			companionId: r.companionId,
			name: c?.name ?? '',
			category: (c?.category as 'adult' | 'child' | 'other') ?? 'other',
			status: r.status
		};
	});
}

function getCompanionById(id: number): { name: string; category: string } | null {
	const kitRow = kit.selectFrom(tripCompanions).where(kitEq(tripCompanions.id, toBigInt(id))).executeSync()[0];
	if (kitRow) return { name: kitRow.name, category: kitRow.category };
	return null;
}

export function addAttendee(input: CreateAttendeeInput) {
	const created = kit.insertInto(segmentAttendees).values(input as Insert<typeof segmentAttendees>).executeSync();
	return toAttendeeRow(created);
}

export function upsertAttendee(segmentId: number, companionId: number, status: string) {
	const existing = getAttendeeBySegmentAndCompanion(segmentId, companionId);
	if (existing) {
		return updateAttendee(existing.id, { status })!;
	}
	return addAttendee({
		segment_id: toBigInt(segmentId),
		companion_id: toBigInt(companionId),
		status
	});
}

export function updateAttendee(id: number, patch: Update<typeof segmentAttendees>) {
	const existing = kit.selectFrom(segmentAttendees).where(kitEq(segmentAttendees.id, toBigInt(id))).executeSync()[0];
	if (!existing) return null;
	const merged: Update<typeof segmentAttendees> = { ...existing, ...patch, id: existing.id };
	const updated = kit
		.updateTable(segmentAttendees)
		.set(merged)
		.where(kitEq(segmentAttendees.id, toBigInt(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	return toAttendeeRow(row);
}

export function removeAttendee(id: number): boolean {
	const deleted = kit.deleteFrom(segmentAttendees).where(kitEq(segmentAttendees.id, toBigInt(id))).executeSync();
	return deleted > 0n;
}

export function removeAttendeeBySegmentAndCompanion(segmentId: number, companionId: number): boolean {
	const attendee = getAttendeeBySegmentAndCompanion(segmentId, companionId);
	if (!attendee) return false;
	return removeAttendee(attendee.id);
}

export function getAttendeeBySegmentAndCompanion(
	segmentId: number,
	companionId: number
) {
	const rows = kit
		.selectFrom(segmentAttendees)
		.where(
			kitAnd(
				kitEq(segmentAttendees.segment_id, toBigInt(segmentId)),
				kitEq(segmentAttendees.companion_id, toBigInt(companionId))
			)
		)
		.executeSync();
	return rows[0] ? toAttendeeRow(rows[0]) : null;
}
