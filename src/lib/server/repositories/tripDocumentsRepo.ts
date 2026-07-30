import { eq as kitEq, asc, joinEq, inList as kitInList } from '@visorcraft/mongreldb-kit';
import {
	runSyncTxn,
	toCells,
	enforceForeignKeys,
	stageUniqueGuards,
	stagePkGuard,
	planDelete
} from '@visorcraft/mongreldb-kit';
import { kit, getDb } from '$lib/server/db';
import { tripDocuments, attachments } from '$lib/server/db/mongrelSchema';
import { nowIso } from '$lib/server/tz';

function toBigInt(id: number): bigint {
	return BigInt(id);
}

function num(v: bigint | number): number {
	return Number(v);
}

function nullableIntToNumber(id: bigint | null | undefined): number | null {
	if (id == null || id === 0n) return null;
	return Number(id);
}

export interface TripDocumentRow {
	/** Link row id (use in download/delete URLs). */
	id: number;
	tripId: number;
	segmentId: number | null;
	attachmentId: number;
	label: string | null;
	notes: string | null;
	filename: string;
	contentType: string;
	sizeBytes: number;
	createdAt: Date | string;
}

export interface TripDocumentLinkRow {
	id: number;
	tripId: number;
	segmentId: number | null;
	attachmentId: number;
	label: string | null;
	notes: string | null;
	createdAt: Date | string;
}

function mapJoinedRow(row: Record<string, Record<string, unknown> | null>): TripDocumentRow {
	const link = row.trip_documents;
	const att = row.attachments;
	if (!link || !att) throw new Error('Missing trip document join data');
	return {
		id: num(link.id as bigint),
		tripId: num(link.trip_id as bigint),
		segmentId: nullableIntToNumber(link.segment_id as bigint | null),
		attachmentId: num(att.id as bigint),
		label: (link.label as string | null) ?? null,
		notes: (link.notes as string | null) ?? null,
		filename: String(att.filename),
		contentType: String(att.content_type),
		sizeBytes: Number(att.size_bytes),
		createdAt: link.created_at as Date | string
	};
}

function constraintKit() {
	const db = getDb();
	return { db: db.nativeDb, schema: db.schema };
}

export function listDocumentsForTrip(tripId: number): TripDocumentRow[] {
	const ordered = kit
		.selectFrom(tripDocuments)
		.where(kitEq(tripDocuments.trip_id, toBigInt(tripId)))
		.orderBy(asc(tripDocuments.created_at));

	const rows = kit
		.with('trip_documents', ordered)
		.selectFrom('trip_documents')
		.innerJoin(
			attachments,
			joinEq(tripDocuments, tripDocuments.attachment_id, attachments, attachments.id)
		)
		.executeSync();
	return rows.map(mapJoinedRow);
}

export function listDocumentsForSegment(segmentId: number): TripDocumentRow[] {
	const ordered = kit
		.selectFrom(tripDocuments)
		.where(kitEq(tripDocuments.segment_id, toBigInt(segmentId)))
		.orderBy(asc(tripDocuments.created_at));

	const rows = kit
		.with('trip_documents', ordered)
		.selectFrom('trip_documents')
		.innerJoin(
			attachments,
			joinEq(tripDocuments, tripDocuments.attachment_id, attachments, attachments.id)
		)
		.executeSync();
	return rows.map(mapJoinedRow);
}

export function listDocumentsForSegments(segmentIds: number[]): Map<number, TripDocumentRow[]> {
	const map = new Map<number, TripDocumentRow[]>();
	for (const id of segmentIds) map.set(id, []);
	if (segmentIds.length === 0) return map;

	const ordered = kit
		.selectFrom(tripDocuments)
		.where(kitInList(tripDocuments.segment_id, segmentIds.map(toBigInt)))
		.orderBy(asc(tripDocuments.created_at));

	const rows = kit
		.with('trip_documents', ordered)
		.selectFrom('trip_documents')
		.innerJoin(
			attachments,
			joinEq(tripDocuments, tripDocuments.attachment_id, attachments, attachments.id)
		)
		.executeSync();

	for (const row of rows) {
		const mapped = mapJoinedRow(row);
		if (mapped.segmentId != null) map.get(mapped.segmentId)?.push(mapped);
	}
	return map;
}

export function createTripDocumentLink(input: {
	tripId: number;
	segmentId?: number | null;
	attachmentId: number;
	label?: string | null;
	notes?: string | null;
}): TripDocumentLinkRow {
	const db = getDb();
	const id = db.reserveAutoIncSync(tripDocuments.name)!;
	const now = nowIso();
	const row = {
		id,
		trip_id: toBigInt(input.tripId),
		segment_id: input.segmentId != null ? toBigInt(input.segmentId) : null,
		attachment_id: toBigInt(input.attachmentId),
		label: input.label?.trim() || null,
		notes: input.notes?.trim() || null,
		created_at: now
	};
	const ck = constraintKit();
	let result: TripDocumentLinkRow;
	runSyncTxn(db, (txn) => {
		enforceForeignKeys(ck, txn, tripDocuments, row);
		stageUniqueGuards(ck, txn, tripDocuments, row, id);
		stagePkGuard(ck, txn, tripDocuments, id, true);
		txn.put(tripDocuments.name, toCells(tripDocuments, row));
		result = {
			id: num(row.id),
			tripId: num(row.trip_id),
			segmentId: nullableIntToNumber(row.segment_id),
			attachmentId: num(row.attachment_id),
			label: row.label,
			notes: row.notes,
			createdAt: row.created_at
		};
	});
	return result!;
}

export function getTripDocumentLinkById(id: number): TripDocumentLinkRow | null {
	const rows = kit.selectFrom(tripDocuments).where(kitEq(tripDocuments.id, toBigInt(id))).executeSync();
	if (!rows[0]) return null;
	const link = rows[0];
	return {
		id: num(link.id),
		tripId: num(link.trip_id),
		segmentId: nullableIntToNumber(link.segment_id as bigint | null),
		attachmentId: num(link.attachment_id),
		label: (link.label as string | null) ?? null,
		notes: (link.notes as string | null) ?? null,
		createdAt: link.created_at
	};
}

export function deleteTripDocumentLink(id: number): boolean {
	const db = getDb();
	const rowJs = db.nativeDb.table(tripDocuments.name).getByPkInt64(BigInt(id));
	if (!rowJs) return false;
	const row = db.selectFrom(tripDocuments).where(kitEq(tripDocuments.id, BigInt(id))).executeSync()[0];
	if (!row) return false;
	const ck = constraintKit();
	runSyncTxn(db, (txn) => {
		planDelete(ck, txn, tripDocuments, BigInt(id), { row, rowId: rowJs.rowId });
	});
	return true;
}

/** Trip-level only (segment_id is null). */
export function listTripLevelDocuments(tripId: number): TripDocumentRow[] {
	return listDocumentsForTrip(tripId).filter((d) => d.segmentId == null);
}
