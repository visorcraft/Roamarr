import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from './db';
import { tripExpenseAttachments, tripExpenses } from './db/schema';
import { requireEditableTrip } from './ownership';
import { logAudit } from './audit';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_SIZE = 5 * 1024 * 1024;

function attachmentsDir(): string {
	const dbPath = process.env.DATABASE_PATH;
	if (dbPath) {
		return path.join(path.dirname(dbPath), 'attachments');
	}
	return path.resolve('./data/attachments');
}

function attachmentDirFor(storageKey: string): string {
	return path.join(attachmentsDir(), storageKey.slice(0, 2), storageKey.slice(2, 4));
}

function attachmentPath(storageKey: string): string {
	return path.join(attachmentDirFor(storageKey), storageKey);
}

function requireAttachment(userId: number, attachmentId: number) {
	const row = db
		.select({
			id: tripExpenseAttachments.id,
			expenseId: tripExpenseAttachments.expenseId,
			storageKey: tripExpenseAttachments.storageKey,
			filename: tripExpenseAttachments.filename,
			contentType: tripExpenseAttachments.contentType,
			sizeBytes: tripExpenseAttachments.sizeBytes,
			tripId: tripExpenses.tripId
		})
		.from(tripExpenseAttachments)
		.innerJoin(tripExpenses, eq(tripExpenseAttachments.expenseId, tripExpenses.id))
		.where(eq(tripExpenseAttachments.id, attachmentId))
		.get();
	if (!row) throw error(404, 'Attachment not found');
	requireEditableTrip(userId, row.tripId);
	return row;
}

export async function addAttachment(
	userId: number,
	expenseId: number,
	file: File
): Promise<typeof tripExpenseAttachments.$inferSelect> {
	const expense = db
		.select({ tripId: tripExpenses.tripId })
		.from(tripExpenses)
		.where(eq(tripExpenses.id, expenseId))
		.get();
	if (!expense) throw error(404, 'Expense not found');
	requireEditableTrip(userId, expense.tripId);

	if (!ALLOWED_TYPES.includes(file.type)) {
		throw error(400, 'Only JPEG, PNG, WebP, or PDF files are allowed');
	}
	if (file.size > MAX_SIZE) {
		throw error(400, 'File must be 5 MB or smaller');
	}

	const storageKey = crypto.randomUUID();
	const dir = attachmentDirFor(storageKey);
	mkdirSync(dir, { recursive: true });
	const bytes = Buffer.from(await file.arrayBuffer());
	writeFileSync(attachmentPath(storageKey), bytes);

	const inserted = db
		.insert(tripExpenseAttachments)
		.values({
			expenseId,
			filename: file.name,
			storageKey,
			contentType: file.type,
			sizeBytes: file.size
		})
		.returning()
		.get();

	logAudit(userId, 'create', 'trip_expense_attachment', inserted.id, {
		expenseId,
		filename: file.name
	});
	return inserted;
}

export function listAttachments(expenseId: number) {
	return db
		.select()
		.from(tripExpenseAttachments)
		.where(eq(tripExpenseAttachments.expenseId, expenseId))
		.orderBy(tripExpenseAttachments.createdAt)
		.all();
}

export function getAttachmentWithPath(userId: number, attachmentId: number) {
	const row = requireAttachment(userId, attachmentId);
	const fullPath = attachmentPath(row.storageKey);
	if (!existsSync(fullPath)) throw error(404, 'Attachment file missing');
	return { ...row, path: fullPath };
}

export function deleteAttachment(userId: number, attachmentId: number) {
	const row = requireAttachment(userId, attachmentId);
	const fullPath = attachmentPath(row.storageKey);
	try {
		if (existsSync(fullPath)) unlinkSync(fullPath);
	} catch {
		// ignore
	}
	db.delete(tripExpenseAttachments).where(eq(tripExpenseAttachments.id, attachmentId)).run();
	logAudit(userId, 'delete', 'trip_expense_attachment', attachmentId, {
		expenseId: row.expenseId
	});
}
