import { error } from '@sveltejs/kit';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getAttachmentsPath } from '../paths';
import { encryptChunkedFile } from './attachmentCrypto';
import {
	attachmentPath,
	readEncryptedAttachmentStream,
	deleteEncryptedAttachment
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
	const stagingKey = randomUUID();
	const stagingPath = attachmentPath(stagingKey, baseDir);
	const finalKey = randomUUID();

	let plaintextBytes = 0;
	try {
		const result = await encryptChunkedFile(
			file.stream() as ReadableStream<Uint8Array>,
			stagingPath,
			{ maxBytes: MAX_SIZE }
		);
		plaintextBytes = result.plaintextBytes;
	} catch (e) {
		try {
			await fs.unlink(stagingPath);
		} catch {
			// ignore cleanup failure
		}
		if ((e as Error).message.includes('maximum allowed size')) {
			throw error(400, 'File must be 10 MB or smaller');
		}
		throw e;
	}

	let row: repo.AttachmentRecord | undefined;
	try {
		row = repo.createAttachment({
			ownerId,
			storageKey: finalKey,
			filename: file.name,
			contentType: file.type,
			sizeBytes: plaintextBytes,
			context
		});

		const finalPath = attachmentPath(finalKey, baseDir);
		await fs.mkdir(path.dirname(finalPath), { recursive: true });
		await fs.rename(stagingPath, finalPath);
	} catch (e) {
		if (row) {
			try {
				repo.deleteAttachment(row.id);
			} catch {
				// best-effort DB cleanup
			}
		}
		try {
			await fs.unlink(stagingPath);
		} catch {
			// ignore cleanup failure
		}
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
	repo.deleteAttachment(attachmentId);
	deleteEncryptedAttachment(row.storageKey, baseDir);

	logAudit(row.ownerId, 'delete', 'attachment', attachmentId, {
		filename: row.filename
	});

	return row;
}
