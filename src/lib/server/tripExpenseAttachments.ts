import { error } from '@sveltejs/kit';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as expensesRepo from './repositories/expensesRepo';
import type { AttachmentRow } from './repositories/expensesRepo';
import { requireEditableTrip } from './ownership';
import { logAudit } from './audit';
import { getAttachmentsPath } from './paths';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_SIZE = 5 * 1024 * 1024;

function attachmentsDir(): string {
	return getAttachmentsPath();
}

function attachmentDirFor(storageKey: string): string {
	return path.join(attachmentsDir(), storageKey.slice(0, 2), storageKey.slice(2, 4));
}

function attachmentPath(storageKey: string): string {
	return path.join(attachmentDirFor(storageKey), storageKey);
}

function requireAttachment(userId: number, attachmentId: number) {
	const attachment = expensesRepo.getAttachmentById(attachmentId);
	if (!attachment) throw error(404, 'Attachment not found');
	const expense = expensesRepo.getExpenseById(attachment.expenseId);
	if (!expense) throw error(404, 'Expense not found');
	requireEditableTrip(userId, expense.tripId);
	return { ...attachment, tripId: expense.tripId };
}

export async function addAttachment(
	userId: number,
	expenseId: number,
	file: File
): Promise<AttachmentRow> {
	const expense = expensesRepo.getExpenseById(expenseId);
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

	const inserted = expensesRepo.createAttachment({
		expenseId,
		filename: file.name,
		storageKey,
		contentType: file.type,
		sizeBytes: file.size
	});

	logAudit(userId, 'create', 'trip_expense_attachment', inserted.id, {
		expenseId,
		filename: file.name
	});
	return inserted;
}

export function listAttachments(expenseId: number) {
	return expensesRepo.listAttachmentsForExpense(expenseId);
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
	expensesRepo.deleteAttachment(attachmentId);
	logAudit(userId, 'delete', 'trip_expense_attachment', attachmentId, {
		expenseId: row.expenseId
	});
}
