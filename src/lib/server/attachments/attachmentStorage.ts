import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { encryptChunkedFile, decryptChunkedFileStream, AttachmentSizeLimitError } from './attachmentCrypto';

export { AttachmentSizeLimitError };

const STORAGE_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function attachmentPath(storageKey: string, baseDir: string): string {
	if (!STORAGE_KEY_RE.test(storageKey)) {
		throw new Error('invalid attachment storage key');
	}
	return path.join(baseDir, storageKey.slice(0, 2), storageKey.slice(2, 4), storageKey);
}

export interface SaveOptions {
	maxBytes?: number;
}

export interface StageResult {
	storageKey: string;
	plaintextBytes: number;
	chunkCount: number;
	stagingPath: string;
	finalPath: string;
}

export async function stageEncryptedAttachment(
	input: ReadableStream<Uint8Array>,
	baseDir: string,
	options: SaveOptions = {}
): Promise<StageResult> {
	const storageKey = randomUUID();
	const finalPath = attachmentPath(storageKey, baseDir);
	const stagingPath = `${finalPath}.staging`;
	const { plaintextBytes, chunkCount } = await encryptChunkedFile(input, stagingPath, options);
	return { storageKey, plaintextBytes, chunkCount, stagingPath, finalPath };
}

export async function commitAttachment(stagingPath: string, finalPath: string): Promise<void> {
	await fs.rename(stagingPath, finalPath);
}

export async function abortAttachment(stagingPath: string): Promise<void> {
	await fs.rm(stagingPath, { force: true });
}

export async function readEncryptedAttachmentStream(
	storageKey: string,
	baseDir: string
): Promise<ReadableStream<Uint8Array>> {
	const finalPath = attachmentPath(storageKey, baseDir);
	return decryptChunkedFileStream(finalPath);
}

// Silently succeeds if the file is already gone (idempotent deletion).
export async function deleteEncryptedAttachment(storageKey: string, baseDir: string): Promise<void> {
	const p = attachmentPath(storageKey, baseDir);
	await fs.rm(p, { force: true });
}
