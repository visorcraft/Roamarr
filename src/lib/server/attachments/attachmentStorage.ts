import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { encryptChunkedFile, decryptChunkedFileStream } from './attachmentCrypto';
import type { EncryptResult } from './attachmentCrypto';

export function attachmentPath(storageKey: string, baseDir: string): string {
	return path.join(baseDir, storageKey.slice(0, 2), storageKey.slice(2, 4), storageKey);
}

export interface SaveResult extends EncryptResult {
	storageKey: string;
}

export async function saveEncryptedAttachment(
	input: ReadableStream<Uint8Array>,
	baseDir: string
): Promise<SaveResult> {
	const storageKey = randomUUID();
	const outPath = attachmentPath(storageKey, baseDir);
	const { plaintextBytes, chunkCount } = await encryptChunkedFile(input, outPath);
	return { storageKey, plaintextBytes, chunkCount };
}

export async function readEncryptedAttachmentStream(
	storageKey: string,
	baseDir: string
): Promise<ReadableStream<Uint8Array>> {
	return decryptChunkedFileStream(attachmentPath(storageKey, baseDir));
}

export function deleteEncryptedAttachment(storageKey: string, baseDir: string): void {
	const p = attachmentPath(storageKey, baseDir);
	if (existsSync(p)) rmSync(p);
}
