import { error } from '@sveltejs/kit';
import { getAttachmentsPath } from '../paths';
import {
	saveEncryptedAttachment,
	readEncryptedAttachmentStream,
	deleteEncryptedAttachment,
	AttachmentSizeLimitError
} from './attachmentStorage';
import * as repo from './attachmentRepo';
import { logAudit } from '../audit';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const MAX_SIZE = 10 * 1024 * 1024;

export interface CreateAttachmentInput {
	ownerId: number;
	file: File;
	context: Record<string, unknown>;
}

export async function createAttachment(input: CreateAttachmentInput) {
	const { ownerId, file, context } = input;

	if (!ALLOWED_TYPES.includes(file.type)) {
		throw error(400, 'Only JPEG, PNG, WebP, or PDF files are allowed');
	}
	if (file.size > MAX_SIZE) {
		throw error(400, 'File must be 10 MB or smaller');
	}

	const baseDir = getAttachmentsPath();
	let saveResult: Awaited<ReturnType<typeof saveEncryptedAttachment>>;
	try {
		saveResult = await saveEncryptedAttachment(file.stream(), baseDir, { maxBytes: MAX_SIZE });
	} catch (e) {
		if (e instanceof AttachmentSizeLimitError) {
			throw error(400, 'File must be 10 MB or smaller');
		}
		throw e;
	}
	const { storageKey, plaintextBytes } = saveResult;

	let row: repo.AttachmentRecord;
	try {
		row = repo.createAttachment({
			ownerId,
			storageKey,
			filename: file.name,
			contentType: file.type,
			sizeBytes: plaintextBytes,
			context
		});
	} catch (e) {
		await deleteEncryptedAttachment(storageKey, baseDir);
		throw e;
	}

	logAudit(ownerId, 'create', 'attachment', row.id, {
		filename: file.name,
		contentType: file.type,
		contextKind: context.kind
	});

	return row;
}

export async function readAttachmentStream(
	attachmentId: number
): Promise<{ stream: ReadableStream<Uint8Array>; record: repo.AttachmentRecord }> {
	const row = repo.getAttachmentById(attachmentId);
	if (!row) throw error(404, 'Attachment not found');

	const baseDir = getAttachmentsPath();
	const stream = await readEncryptedAttachmentStream(row.storageKey, baseDir);
	return { stream, record: row };
}

export async function deleteAttachment(attachmentId: number): Promise<repo.AttachmentRecord> {
	const row = repo.getAttachmentById(attachmentId);
	if (!row) throw error(404, 'Attachment not found');

	const baseDir = getAttachmentsPath();
	await deleteEncryptedAttachment(row.storageKey, baseDir);
	repo.deleteAttachment(attachmentId);

	logAudit(row.ownerId, 'delete', 'attachment', attachmentId, {
		filename: row.filename
	});

	return row;
}
