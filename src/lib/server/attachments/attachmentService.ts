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

const MAGIC_BYTES: Record<string, Uint8Array[]> = {
	'image/jpeg': [new Uint8Array([0xff, 0xd8, 0xff])],
	'image/png': [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
	'image/webp': [new Uint8Array([0x52, 0x49, 0x46, 0x46])],
	'application/pdf': [new Uint8Array([0x25, 0x50, 0x44, 0x46])]
};

async function validateMagicBytes(file: File): Promise<void> {
	const expected = MAGIC_BYTES[file.type];
	if (!expected) return; // No magic-byte check for unknown types (they're rejected earlier anyway).
	const prefix = new Uint8Array(await file.slice(0, Math.max(...expected.map((m) => m.length))).arrayBuffer());
	if (!expected.some((m) => prefix.length >= m.length && m.every((b, i) => b === prefix[i]))) {
		throw error(400, 'File content does not match its extension/content type');
	}
}

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
	await validateMagicBytes(file);

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
