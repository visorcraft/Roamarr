import { attachments } from '../db/mongrelSchema';
import { getDb } from '../db';
import { nowIso } from '../tz';
import {
	eq,
	runSyncTxn,
	toCells,
	enforceForeignKeys,
	stageUniqueGuards,
	stagePkGuard,
	planDelete
} from '@visorcraft/mongreldb-kit';

export interface AttachmentInsert {
	ownerId: number;
	storageKey: string;
	filename: string;
	contentType: string;
	sizeBytes: number;
	context: Record<string, unknown>;
}

export interface AttachmentRecord {
	id: number;
	ownerId: number;
	storageKey: string;
	filename: string;
	contentType: string;
	sizeBytes: number;
	context: Record<string, unknown>;
	createdAt: Date | string;
}

function parseContext(value: unknown): Record<string, unknown> {
	if (value == null) return {};
	if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			/* fall through to empty default */
		}
	}
	return {};
}

function mapRow(row: Record<string, unknown>): AttachmentRecord {
	return {
		id: Number(row.id),
		ownerId: Number(row.owner_id),
		storageKey: String(row.storage_key),
		filename: String(row.filename),
		contentType: String(row.content_type),
		sizeBytes: Number(row.size_bytes),
		context: parseContext(row.context),
		createdAt: row.created_at as Date | string
	};
}

function constraintKit() {
	const db = getDb();
	return { db: db.nativeDb, schema: db.schema };
}

export function createAttachment(input: AttachmentInsert): AttachmentRecord {
	const db = getDb();
	const id = db.reserveAutoIncSync(attachments.name)!;
	const now = nowIso();
	const row = {
		id,
		owner_id: BigInt(input.ownerId),
		storage_key: input.storageKey,
		filename: input.filename,
		content_type: input.contentType,
		size_bytes: BigInt(input.sizeBytes),
		context: JSON.stringify(input.context),
		created_at: now
	};
	const ck = constraintKit();
	let result: AttachmentRecord;
	runSyncTxn(db, (txn) => {
		enforceForeignKeys(ck, txn, attachments, row);
		stageUniqueGuards(ck, txn, attachments, row, id);
		stagePkGuard(ck, txn, attachments, id, true);
		txn.put(attachments.name, toCells(attachments, row));
		result = mapRow(row);
	});
	return result!;
}

export function getAttachmentById(id: number): AttachmentRecord | null {
	const db = getDb();
	const row = db
		.selectFrom(attachments)
		.where(eq(attachments.id, BigInt(id)))
		.executeSync()[0];
	if (!row) return null;
	return mapRow(row);
}

export function deleteAttachment(id: number): void {
	const db = getDb();
	const rowJs = db.nativeDb.table(attachments.name).getByPkInt64(BigInt(id));
	if (!rowJs) return;
	const row = db.selectFrom(attachments).where(eq(attachments.id, BigInt(id))).executeSync()[0];
	if (!row) return;
	const ck = constraintKit();
	runSyncTxn(db, (txn) => {
		planDelete(ck, txn, attachments, BigInt(id), { row, rowId: rowJs.rowId });
	});
}
