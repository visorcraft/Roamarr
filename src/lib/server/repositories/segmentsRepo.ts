import { eq as kitEq, and as kitAnd, inList as kitInList, asc as kitAsc } from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import { segments, segmentAttendees, tripCompanions } from '$lib/server/db/mongrelSchema';
import type { Row, Insert, Update } from '@visorcraft/mongreldb-kit';
import type { SegmentType, SegmentStatus, SegmentAttendeeStatus, CompanionCategory } from '$lib/server/db/mongrelSchema';

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
	category: CompanionCategory;
	status: SegmentAttendeeStatus;
};

function toBigInt(id: number): bigint {
	return BigInt(id);
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
	// Full scan + filter (not RangeInt on segments_trip_idx).
	// Kit/MongrelDB secondary-index queries have been observed to miss rows that
	// still exist by primary key with a correct trip_id after segment updates —
	// so itineraries went blank even though the data was present. Roamarr segment
	// counts are small; prefer complete results over an index shortcut.
	const wanted = new Set(tripIds);
	return kit
		.selectFrom(segments)
		.orderBy(kitAsc(segments.start_at))
		.executeSync()
		.filter((row) => wanted.has(Number(row.trip_id)))
		.map(toSegmentRow);
}

export function getSegmentById(id: number) {
	const rows = kit.selectFrom(segments).where(kitEq(segments.id, toBigInt(id))).executeSync();
	return rows[0] ? toSegmentRow(rows[0]) : null;
}

export function createSegment(input: CreateSegmentInput) {
	const created = kit.insertInto(segments).values(input as Insert<typeof segments>).executeSync();
	const segment = toSegmentRow(created);
	void import('$lib/server/embeddings/search')
		.then((m) => m.scheduleIndexTrip(segment.tripId))
		.catch(() => {});
	return segment;
}

export function updateSegment(id: number, patch: UpdateSegmentInput) {
	const existing = kit.selectFrom(segments).where(kitEq(segments.id, toBigInt(id))).executeSync()[0];
	if (!existing) return null;

	// Pass only fields the caller intends to change. Kit's applyUpdateInTxn already
	// merges the patch onto the on-disk row. Spreading the full `existing` row into
	// set() re-writes every secondary-index key (including segments_trip_idx). That
	// full-row rewrite has been observed to drop index entries so
	// listSegmentsForTrip silently omits still-present rows after MCP/UI updates —
	// getSegmentById (primary key) still finds them, but trip itineraries go blank.
	const set = sanitizeSegmentUpdatePatch(patch);
	if (Object.keys(set).length === 0) {
		// Nothing to write; return the current projection.
		return toSegmentRow(existing);
	}

	const updated = kit
		.updateTable(segments)
		.set(set as Update<typeof segments>)
		.where(kitEq(segments.id, toBigInt(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	const segment = toSegmentRow(row);
	void import('$lib/server/embeddings/search')
		.then((m) => m.scheduleIndexTrip(segment.tripId))
		.catch(() => {});
	return segment;
}

/** Build a kit `set()` payload: defined patch fields only, immutable keys stripped. */
function sanitizeSegmentUpdatePatch(patch: UpdateSegmentInput): Record<string, unknown> {
	const set: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
		// `undefined` must not be spread into set() — kit merges it as SQL NULL.
		if (value === undefined) continue;
		if (key === 'id' || key === 'trip_id' || key === 'created_at') continue;
		set[key] = value;
	}
	if (set.card_id === 0n || set.card_id === 0) set.card_id = null;
	// json columns are stored as text; objects must be serialized before toCells.
	if (set.details_json != null && typeof set.details_json === 'object') {
		set.details_json = JSON.stringify(set.details_json);
	}
	return set;
}

export function deleteSegment(id: number): boolean {
	const deleted = kit.deleteFrom(segments).where(kitEq(segments.id, toBigInt(id))).executeSync();
	if (deleted > 0n) {
		void import('$lib/server/embeddings/index')
			.then((m) => m.removeSearchDocument('segment', id))
			.catch(() => {});
	}
	return deleted > 0n;
}

export function deleteSegmentsForTrip(tripId: number, ids?: number[]): bigint {
	if (ids && ids.length === 0) return 0n;
	// Delete by primary key after resolving membership via listSegmentsForTrip so
	// we do not rely on a possibly-desynced trip_id secondary index for the WHERE.
	const members = listSegmentsForTrip(tripId);
	const toDelete = ids?.length ? members.filter((s) => ids.includes(s.id)) : members;
	let n = 0n;
	for (const seg of toDelete) {
		if (deleteSegment(seg.id)) n += 1n;
	}
	return n;
}

export function countOverlappingSegments(
	tripId: number,
	startAt: string,
	endAt: string,
	excludeSegmentId?: number
): bigint {
	// Use listSegmentsForTrip (full-scan membership) so desynced trip_id indexes
	// cannot under-count overlaps.
	const members = listSegmentsForTrip(tripId);
	let n = 0;
	for (const s of members) {
		if (excludeSegmentId != null && s.id === excludeSegmentId) continue;
		if (!s.endAt) continue;
		if (s.startAt < endAt && s.endAt > startAt) n += 1;
	}
	return BigInt(n);
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
	const companionMap = getCompanionsByIds(companionIds);

	return rows.map((r) => {
		const c = companionMap.get(r.companionId);
		return {
			id: r.id,
			segmentId: r.segmentId,
			companionId: r.companionId,
			name: c?.name ?? '',
			category: (c?.category as CompanionCategory) ?? 'other',
			status: r.status
		};
	});
}

function getCompanionsByIds(ids: number[]): Map<number, { name: string; category: string }> {
	const map = new Map<number, { name: string; category: string }>();
	if (ids.length === 0) return map;
	const rows = kit
		.selectFrom(tripCompanions)
		.where(kitInList(tripCompanions.id, ids.map(toBigInt)))
		.executeSync();
	for (const row of rows) {
		map.set(Number(row.id), { name: row.name, category: row.category });
	}
	return map;
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
	// Same partial-patch rule as updateSegment: do not full-row merge into set().
	const set: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
		if (value === undefined) continue;
		if (key === 'id' || key === 'segment_id' || key === 'companion_id' || key === 'created_at') continue;
		set[key] = value;
	}
	if (Object.keys(set).length === 0) return toAttendeeRow(existing);
	const updated = kit
		.updateTable(segmentAttendees)
		.set(set as Update<typeof segmentAttendees>)
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
