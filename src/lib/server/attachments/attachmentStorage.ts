import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { encryptChunkedFile, decryptChunkedFileStream, AttachmentSizeLimitError } from './attachmentCrypto';
import type { EncryptResult } from './attachmentCrypto';

export { AttachmentSizeLimitError };

const STORAGE_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function attachmentPath(storageKey: string, baseDir: string): string {
	if (!STORAGE_KEY_RE.test(storageKey)) {
		throw new Error('invalid attachment storage key');
	}
	return path.join(baseDir, storageKey.slice(0, 2), storageKey.slice(2, 4), storageKey);
}

export interface SaveResult extends EncryptResult {
	storageKey: string;
}

export interface SaveOptions {
	maxBytes?: number;
}

export async function saveEncryptedAttachment(
	input: ReadableStream<Uint8Array>,
	baseDir: string,
	options: SaveOptions = {}
): Promise<SaveResult> {
	const storageKey = randomUUID();
	const outPath = attachmentPath(storageKey, baseDir);
	const { plaintextBytes, chunkCount } = await encryptChunkedFile(input, outPath, options);
	return { storageKey, plaintextBytes, chunkCount };
}

export async function readEncryptedAttachmentStream(
	storageKey: string,
	baseDir: string
): Promise<ReadableStream<Uint8Array>> {
	return decryptChunkedFileStream(attachmentPath(storageKey, baseDir));
}

// Silently succeeds if the file is already gone (idempotent deletion).
export async function deleteEncryptedAttachment(storageKey: string, baseDir: string): Promise<void> {
	const p = attachmentPath(storageKey, baseDir);
	await fs.rm(p, { force: true });
}
