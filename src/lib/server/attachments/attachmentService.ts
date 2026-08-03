import { error } from '@sveltejs/kit';
import { getAttachmentsPath } from '../paths';
import {
	stageEncryptedAttachment,
	commitAttachment,
	abortAttachment,
	readEncryptedAttachmentStream,
	deleteEncryptedAttachment,
	AttachmentSizeLimitError
} from './attachmentStorage';
import * as repo from './attachmentRepo';
import { logAudit } from '../audit';

/**
 * SECURITY NOTE: This module performs NO authorization checks. It validates
 * input format/size and stores/retrieves ciphertext. Callers (e.g.
 * tripExpenseAttachments) are responsible for enforcing context-specific
 * authorization before calling these functions.
 */

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const MAX_SIZE = 10 * 1024 * 1024;

/** Canonical stored type for GPS tracks; downloads always use this, never text/xml. */
export const GPX_CONTENT_TYPE = 'application/gpx+xml';
// Browsers label .gpx files inconsistently; tolerate generic XML/binary types,
// but only when the file name actually ends in .gpx.
const GPX_TOLERATED_TYPES = [GPX_CONTENT_TYPE, 'application/xml', 'text/xml', 'application/octet-stream', ''];

export function isGpxFile(file: File): boolean {
	return file.name.toLowerCase().endsWith('.gpx') && GPX_TOLERATED_TYPES.includes(file.type);
}

/**
 * Content sniff for GPX: after an optional BOM and XML declaration, the root
 * tag must be <gpx>. This rejects HTML or arbitrary XML renamed to .gpx, which
 * matters anywhere a file could otherwise be served with an XML/HTML type.
 */
async function validateGpxContent(file: File): Promise<void> {
	const head = new TextDecoder().decode(await file.slice(0, 4096).arrayBuffer());
	let s = head;
	if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // strip UTF-8 BOM
	s = s.trimStart();
	if (s.startsWith('<?xml')) {
		const end = s.indexOf('?>');
		if (end === -1) throw error(400, 'File content does not match its extension/content type');
		s = s.slice(end + 2).trimStart();
	}
	if (!s.startsWith('<gpx') || !'/> \t\r\n'.includes(s.charAt(4))) {
		throw error(400, 'File content does not match its extension/content type');
	}
}

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

	const gpx = isGpxFile(file);
	if (!gpx && !ALLOWED_TYPES.includes(file.type)) {
		throw error(400, 'Only JPEG, PNG, WebP, PDF, or GPX files are allowed');
	}
	if (file.size > MAX_SIZE) {
		throw error(400, 'File must be 10 MB or smaller');
	}
	if (gpx) {
		await validateGpxContent(file);
	} else {
		await validateMagicBytes(file);
	}
	// Normalize the stored type so GPX is never later served as text/xml or
	// application/octet-stream.
	const contentType = gpx ? GPX_CONTENT_TYPE : file.type;

	const baseDir = getAttachmentsPath();
	let stageResult: Awaited<ReturnType<typeof stageEncryptedAttachment>>;
	try {
		stageResult = await stageEncryptedAttachment(file.stream(), baseDir, { maxBytes: MAX_SIZE });
	} catch (e) {
		if (e instanceof AttachmentSizeLimitError) {
			throw error(400, 'File must be 10 MB or smaller');
		}
		throw e;
	}

	let row: repo.AttachmentRecord;
	try {
		row = repo.createAttachment({
			ownerId,
			storageKey: stageResult.storageKey,
			filename: file.name,
			contentType,
			sizeBytes: stageResult.plaintextBytes,
			context
		});
		await commitAttachment(stageResult.stagingPath, stageResult.finalPath);
	} catch (e) {
		await abortAttachment(stageResult.stagingPath);
		throw e;
	}

	logAudit(ownerId, 'create', 'attachment', row.id, {
		filename: file.name,
		contentType,
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
	repo.deleteAttachment(attachmentId);
	try {
		await deleteEncryptedAttachment(row.storageKey, baseDir);
	} catch (e) {
		console.warn('Failed to delete attachment ciphertext; file is orphaned', {
			attachmentId,
			storageKey: row.storageKey,
			error: e
		});
	}

	logAudit(row.ownerId, 'delete', 'attachment', attachmentId, {
		filename: row.filename
	});

	return row;
}
