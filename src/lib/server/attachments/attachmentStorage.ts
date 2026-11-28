import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promises as fs, type Dirent } from 'node:fs';
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

/**
 * Age after which a leftover `.staging` file is considered an orphan and is
 * safe to remove. A staging file is only ever renamed to its final path
 * after encryption completes, so anything older than this cannot be a
 * legitimate in-flight upload.
 */
export const STAGING_ORPHAN_MAX_AGE_MS = 60 * 60_000;

/**
 * Delete stale `.staging` orphan files under `baseDir` (recursively, including
 * sharded subdirectories). Committed ciphertext files (without `.staging`)
 * and fresh `.staging` files younger than `maxAgeMs` are never touched.
 * Per-entry errors are logged/ignored so cleanup never throws.
 */
export async function sweepStaleStagingFiles(
	baseDir: string,
	opts: { maxAgeMs?: number; now?: number } = {}
): Promise<number> {
	const maxAgeMs = opts.maxAgeMs ?? STAGING_ORPHAN_MAX_AGE_MS;
	const now = opts.now ?? Date.now();
	const cutoff = now - maxAgeMs;
	let removed = 0;

	async function walk(dir: string): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch (e) {
			if (!(e instanceof Error && (e as NodeJS.ErrnoException).code === 'ENOENT')) {
				console.warn('[attachmentStorage] staging sweep failed to read directory', dir, e);
			}
			return;
		}
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			try {
				if (entry.isDirectory()) {
					await walk(fullPath);
				} else if (entry.isFile() && entry.name.endsWith('.staging')) {
					const stat = await fs.stat(fullPath);
					if (stat.mtimeMs <= cutoff) {
						await fs.rm(fullPath, { force: true });
						removed++;
					}
				}
			} catch (e) {
				console.warn('[attachmentStorage] staging sweep skipped entry', fullPath, e);
			}
		}
	}

	try {
		await walk(baseDir);
	} catch (e) {
		console.warn('[attachmentStorage] staging sweep failed', baseDir, e);
	}
	return removed;
}
