import { eq as kitEq, and as kitAnd, ne as kitNe, lt as kitLt, gt as kitGt, inList as kitInList, asc as kitAsc } from '@mongreldb/kit';
import { eq, and, inArray as inList, asc, lt, gt, ne, not, sql } from 'drizzle-orm';
import { db, kit } from '$lib/server/db';
import { segments, segmentAttendees, tripCompanions } from '$lib/server/db/mongrelSchema';
import {
	segments as drizzleSegments,
	segmentAttendees as drizzleSegmentAttendees,
	tripCompanions as drizzleTripCompanions
} from '$lib/server/db/schema';
import type { Row, Insert, Update } from '@mongreldb/kit';
import type { SegmentType, SegmentStatus, SegmentAttendeeStatus } from '$lib/server/db/schema';

export type KitSegment = Row<typeof segments>;
export type KitSegmentAttendee = Row<typeof segmentAttendees>;
type RequiredSegmentFields = 'trip_id' | 'type' | 'title' | 'start_at';
export type CreateSegmentInput = Pick<Row<typeof segments>, RequiredSegmentFields> &
	Partial<Omit<Row<typeof segments>, 'id' | 'created_at' | 'updated_at' | RequiredSegmentFields>>;
export type UpdateSegmentInput = Update<typeof segments>;

export type CreateAttendeeInput = Pick<Row<typeof segmentAttendees>, 'segment_id' | 'companion_id'> &
	Partial<Omit<Row<typeof segmentAttendees>, 'id' | 'created_at' | 'segment_id' | 'companion_id'>>;

export type SegmentRow = typeof drizzleSegments.$inferSelect;
export type SegmentAttendeeRow = typeof drizzleSegmentAttendees.$inferSelect;

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

function toSegmentRow(row: KitSegment): SegmentRow {
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

function toAttendeeRow(row: KitSegmentAttendee): SegmentAttendeeRow {
	return {
		id: Number(row.id),
		segmentId: Number(row.segment_id),
		companionId: Number(row.companion_id),
		status: row.status as SegmentAttendeeStatus,
		createdAt: row.created_at
	};
}

function kitSegmentToDrizzleRow(row: KitSegment): typeof drizzleSegments.$inferInsert {
	return {
		id: Number(row.id),
		tripId: Number(row.trip_id),
		type: row.type,
		title: row.title,
		startAt: row.start_at,
		startTz: row.start_tz,
		endAt: row.end_at,
		endTz: row.end_tz,
		status: row.status,
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

function kitAttendeeToDrizzleRow(row: KitSegmentAttendee): typeof drizzleSegmentAttendees.$inferInsert {
	return {
		id: Number(row.id),
		segmentId: Number(row.segment_id),
		companionId: Number(row.companion_id),
		status: row.status,
		createdAt: row.created_at
	};
}

function syncSegmentToDrizzle(row: KitSegment) {
	const existing = db.select().from(drizzleSegments).where(eq(drizzleSegments.id, Number(row.id))).get();
	if (existing) {
		db.update(drizzleSegments)
			.set(kitSegmentToDrizzleRow(row))
			.where(eq(drizzleSegments.id, Number(row.id)))
			.run();
	} else {
		db.insert(drizzleSegments).values(kitSegmentToDrizzleRow(row)).run();
	}
}

function syncAttendeeToDrizzle(row: KitSegmentAttendee) {
	const existing = db
		.select()
		.from(drizzleSegmentAttendees)
		.where(eq(drizzleSegmentAttendees.id, Number(row.id)))
		.get();
	if (existing) {
		db.update(drizzleSegmentAttendees)
			.set(kitAttendeeToDrizzleRow(row))
			.where(eq(drizzleSegmentAttendees.id, Number(row.id)))
			.run();
	} else {
		db.insert(drizzleSegmentAttendees).values(kitAttendeeToDrizzleRow(row)).run();
	}
}

function deleteSegmentFromDrizzle(id: number) {
	db.delete(drizzleSegments).where(eq(drizzleSegments.id, id)).run();
}

function deleteAttendeeFromDrizzle(id: number) {
	db.delete(drizzleSegmentAttendees).where(eq(drizzleSegmentAttendees.id, id)).run();
}

// Fallback to legacy Drizzle rows during the migration window. Tests and
// not-yet-migrated code may still seed segments directly in the Drizzle table.
function segmentFromLegacy(id: number): SegmentRow | null {
	return db.select().from(drizzleSegments).where(eq(drizzleSegments.id, id)).get() ?? null;
}

function segmentsFromLegacy(tripIds: number[]): SegmentRow[] {
	if (tripIds.length === 0) return [];
	return db
		.select()
		.from(drizzleSegments)
		.where(inList(drizzleSegments.tripId, tripIds))
		.orderBy(asc(drizzleSegments.startAt))
		.all();
}

function attendeesFromLegacy(segmentIds: number[]): SegmentAttendeeRow[] {
	if (segmentIds.length === 0) return [];
	return db
		.select()
		.from(drizzleSegmentAttendees)
		.where(inList(drizzleSegmentAttendees.segmentId, segmentIds))
		.orderBy(asc(drizzleSegmentAttendees.companionId))
		.all();
}

function companionsFromLegacy(ids: number[]) {
	if (ids.length === 0) return [];
	return db.select().from(drizzleTripCompanions).where(inList(drizzleTripCompanions.id, ids)).all();
}

function mergeUniqueById<T extends { id: number }>(kitRows: T[], legacyRows: T[]): T[] {
	const seen = new Set(kitRows.map((r) => r.id));
	const merged = [...kitRows];
	for (const row of legacyRows) {
		if (!seen.has(row.id)) {
			merged.push(row);
			seen.add(row.id);
		}
	}
	return merged;
}

export function countSegments(): bigint {
	return kit.selectFrom(segments).selectCount().executeSync();
}

export function listSegmentsForTrip(tripId: number): SegmentRow[] {
	return listSegmentsForTrips([tripId]);
}

export function listSegmentsForTrips(tripIds: number[]): SegmentRow[] {
	if (tripIds.length === 0) return [];
	const kitRows = kit
		.selectFrom(segments)
		.where(kitInList(segments.trip_id, tripIds.map(toBigInt)))
		.orderBy(kitAsc(segments.start_at))
		.executeSync()
		.map(toSegmentRow);
	const legacyRows = segmentsFromLegacy(tripIds);
	return mergeUniqueById(kitRows, legacyRows);
}

export function getSegmentById(id: number): SegmentRow | null {
	const rows = kit.selectFrom(segments).where(kitEq(segments.id, toBigInt(id))).executeSync();
	if (rows[0]) return toSegmentRow(rows[0]);
	return segmentFromLegacy(id);
}

export function getSegmentsByIds(ids: number[]): SegmentRow[] {
	if (ids.length === 0) return [];
	const kitRows = kit
		.selectFrom(segments)
		.where(kitInList(segments.id, ids.map(toBigInt)))
		.executeSync()
		.map(toSegmentRow);
	const legacyRows = ids
		.map((id) => segmentFromLegacy(id))
		.filter((r): r is SegmentRow => r !== null);
	return mergeUniqueById(kitRows, legacyRows);
}

export function createSegment(input: CreateSegmentInput): SegmentRow {
	const created = kit.insertInto(segments).values(input as Insert<typeof segments>).executeSync();
	syncSegmentToDrizzle(created);
	return toSegmentRow(created);
}

export function updateSegment(id: number, patch: UpdateSegmentInput): SegmentRow | null {
	const existing = kit.selectFrom(segments).where(kitEq(segments.id, toBigInt(id))).executeSync()[0];
	if (!existing) return null;
	const merged: Update<typeof segments> = { ...existing, ...patch, id: existing.id };
	if (merged.card_id === 0n) merged.card_id = null;
	const updated = kit.updateTable(segments).set(merged).where(kitEq(segments.id, toBigInt(id))).executeSync();
	const row = updated[0];
	if (!row) return null;
	syncSegmentToDrizzle(row);
	return toSegmentRow(row);
}

export function deleteSegment(id: number): boolean {
	const existedInLegacy = segmentFromLegacy(id) !== null;
	const deleted = kit.deleteFrom(segments).where(kitEq(segments.id, toBigInt(id))).executeSync();
	deleteSegmentFromDrizzle(id);
	return deleted > 0n || existedInLegacy;
}

export function deleteSegmentsForTrip(tripId: number, ids?: number[]): bigint {
	if (ids && ids.length === 0) return 0n;
	const predicate = ids?.length
		? kitAnd(kitEq(segments.trip_id, toBigInt(tripId)), kitInList(segments.id, ids.map(toBigInt)))
		: kitEq(segments.trip_id, toBigInt(tripId));
	const deleted = kit.deleteFrom(segments).where(predicate).executeSync();
	const drizzleIds = ids ?? db.select({ id: drizzleSegments.id }).from(drizzleSegments).where(eq(drizzleSegments.tripId, tripId)).all().map((r) => r.id);
	for (const id of drizzleIds) {
		deleteSegmentFromDrizzle(id);
	}
	return deleted;
}

export function countOverlappingSegments(
	tripId: number,
	startAt: string,
	endAt: string,
	excludeSegmentId?: number
): bigint {
	const kitPredicates = [
		kitEq(segments.trip_id, toBigInt(tripId)),
		kitLt(segments.start_at, endAt),
		kitGt(segments.end_at, startAt)
	];
	if (excludeSegmentId != null) {
		kitPredicates.push(kitNe(segments.id, toBigInt(excludeSegmentId)));
	}
	const kitRows = kit.selectFrom(segments).where(kitAnd(...kitPredicates)).executeSync();
	const kitIds = new Set(kitRows.map((r) => Number(r.id)));

	const legacyConditions = [
		eq(drizzleSegments.tripId, tripId),
		lt(drizzleSegments.startAt, endAt),
		gt(drizzleSegments.endAt, startAt)
	];
	if (excludeSegmentId != null) {
		legacyConditions.push(ne(drizzleSegments.id, excludeSegmentId));
	}
	if (kitIds.size > 0) {
		legacyConditions.push(not(inList(drizzleSegments.id, Array.from(kitIds))));
	}
	const legacyCount = BigInt(
		db
			.select({ count: sql<number>`count(*)` })
			.from(drizzleSegments)
			.where(and(...legacyConditions))
			.get()?.count ?? 0
	);

	return BigInt(kitRows.length) + legacyCount;
}

export function listAttendeesForSegment(segmentId: number): AttendeeWithCompanion[] {
	const kitRows = kit
		.selectFrom(segmentAttendees)
		.where(kitEq(segmentAttendees.segment_id, toBigInt(segmentId)))
		.orderBy(kitAsc(segmentAttendees.companion_id))
		.executeSync()
		.map(toAttendeeRow);
	const legacyRows = attendeesFromLegacy([segmentId]);
	const merged = mergeUniqueById(kitRows, legacyRows);
	return hydrateAttendeesWithCompanions(merged);
}

export function listAttendeesForSegments(segmentIds: number[]): Map<number, AttendeeWithCompanion[]> {
	const map = new Map<number, AttendeeWithCompanion[]>();
	for (const id of segmentIds) map.set(id, []);
	if (segmentIds.length === 0) return map;

	const kitRows = kit
		.selectFrom(segmentAttendees)
		.where(kitInList(segmentAttendees.segment_id, segmentIds.map(toBigInt)))
		.orderBy(kitAsc(segmentAttendees.companion_id))
		.executeSync()
		.map(toAttendeeRow);
	const legacyRows = attendeesFromLegacy(segmentIds);
	const merged = mergeUniqueById(kitRows, legacyRows);

	const hydrated = hydrateAttendeesWithCompanions(merged);
	for (const a of hydrated) {
		map.get(a.segmentId)?.push(a);
	}
	return map;
}

function hydrateAttendeesWithCompanions(rows: SegmentAttendeeRow[]): AttendeeWithCompanion[] {
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
			status: r.status as SegmentAttendeeStatus
		};
	});
}

function getCompanionById(id: number): { name: string; category: string } | null {
	const kitRow = kit.selectFrom(tripCompanions).where(kitEq(tripCompanions.id, toBigInt(id))).executeSync()[0];
	if (kitRow) return { name: kitRow.name, category: kitRow.category };
	const legacyRow = db
		.select()
		.from(drizzleTripCompanions)
		.where(eq(drizzleTripCompanions.id, id))
		.get();
	if (legacyRow) return { name: legacyRow.name, category: legacyRow.category };
	return null;
}

function listCompanionsByIds(ids: number[]) {
	if (ids.length === 0) return [];
	return kit.selectFrom(tripCompanions).where(kitInList(tripCompanions.id, ids.map(toBigInt))).executeSync();
}

export function addAttendee(input: CreateAttendeeInput): SegmentAttendeeRow {
	const created = kit.insertInto(segmentAttendees).values(input as Insert<typeof segmentAttendees>).executeSync();
	syncAttendeeToDrizzle(created);
	return toAttendeeRow(created);
}

export function upsertAttendee(segmentId: number, companionId: number, status: string): SegmentAttendeeRow {
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

export function updateAttendee(id: number, patch: Update<typeof segmentAttendees>): SegmentAttendeeRow | null {
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
	syncAttendeeToDrizzle(row);
	return toAttendeeRow(row);
}

export function removeAttendee(id: number): boolean {
	const existedInLegacy = db.select().from(drizzleSegmentAttendees).where(eq(drizzleSegmentAttendees.id, id)).get() !== undefined;
	const deleted = kit.deleteFrom(segmentAttendees).where(kitEq(segmentAttendees.id, toBigInt(id))).executeSync();
	deleteAttendeeFromDrizzle(id);
	return deleted > 0n || existedInLegacy;
}

export function removeAttendeeBySegmentAndCompanion(segmentId: number, companionId: number): boolean {
	const attendee = getAttendeeBySegmentAndCompanion(segmentId, companionId);
	if (!attendee) return false;
	return removeAttendee(attendee.id);
}

export function getAttendeeBySegmentAndCompanion(
	segmentId: number,
	companionId: number
): SegmentAttendeeRow | null {
	const rows = kit
		.selectFrom(segmentAttendees)
		.where(
			kitAnd(
				kitEq(segmentAttendees.segment_id, toBigInt(segmentId)),
				kitEq(segmentAttendees.companion_id, toBigInt(companionId))
			)
		)
		.executeSync();
	if (rows[0]) return toAttendeeRow(rows[0]);
	return (
		db
			.select()
			.from(drizzleSegmentAttendees)
			.where(
				and(
					eq(drizzleSegmentAttendees.segmentId, segmentId),
					eq(drizzleSegmentAttendees.companionId, companionId)
				)
			)
			.get() ?? null
	);
}
