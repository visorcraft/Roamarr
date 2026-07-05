# Encrypted Attachment Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt every uploaded attachment (currently expense receipts) at rest on disk using streaming chunked AES-256-GCM, while keeping attachment metadata in MongrelDB and preserving the existing download/upload interfaces. No plaintext copy of an attachment is ever written to disk during download.

**Architecture:** Introduce a small `attachments` subsystem with three layers: (1) `attachmentCrypto` for chunked AES-256-GCM encryption to a ciphertext file and streaming decryption directly to a web `ReadableStream`, (2) `attachmentStorage` for sharded, extensionless ciphertext files on disk, and (3) `attachmentService` for generic attachment metadata CRUD, validation, and audit logging. Authorization is the caller's responsibility; existing expense attachment code performs trip-based auth and delegates storage to the generic service.

**Tech Stack:** Node.js `crypto` streams, SvelteKit form actions, `node:fs` streams, Vitest, Playwright.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/server/attachments/attachmentCrypto.ts` | Chunked AES-256-GCM primitives: encrypt a `ReadableStream` to a ciphertext file, decrypt a ciphertext file to a web `ReadableStream`. |
| `src/lib/server/attachments/attachmentCrypto.test.ts` | Unit tests for round-trip, tampered-chunk detection, truncation, empty file, and large-file integrity. |
| `src/lib/server/attachments/attachmentStorage.ts` | Sharded ciphertext file storage: save, read as a decrypting stream, delete. |
| `src/lib/server/attachments/attachmentStorage.test.ts` | Unit tests for storage paths and save/read/delete. |
| `src/lib/server/attachments/attachmentService.ts` | Generic attachment service: create/read/delete metadata, content-type/size validation, audit logging. No authorization. |
| `src/lib/server/attachments/attachmentRepo.ts` | MongrelDB queries for the generic `attachments` table. |
| `src/lib/server/attachments/attachmentService.test.ts` | Unit tests for the service layer. |
| `src/lib/server/paths.ts` | Updated so `getAttachmentsPath` respects `ATTACHMENTS_PATH`. |
| `src/lib/server/db/mongrelSchema.ts` | New generic `attachments` table; `trip_expense_attachments` gets `attachment_id` foreign key. |
| `src/lib/server/db/mongrelMigrations/00XX_attachments_table.ts` | Migration for the schema changes. |
| `src/lib/server/tripExpenseAttachments.ts` | Refactored to delegate storage/metadata to `attachmentService` and enforce trip-based auth. |
| `src/lib/server/tripExpenseAttachments.test.ts` | Updated to test encrypted round-trip. |
| `src/lib/server/repositories/expensesRepo.ts` | New helpers for expense/attachment links. |
| `src/routes/trips/[id]/expenses/[expenseId]/attachments/[attachmentId]/+server.ts` | Refactored to stream decrypted chunks directly to the response. |
| `tests/e2e/expenses.spec.ts` or new `tests/e2e/attachments.spec.ts` | E2E coverage that uploads a PDF and downloads it intact. |

---

## Design decisions

### File format on disk

Each ciphertext file is a chunked byte stream (version 2):

```
[ version: 1 byte = 0x02 ]
[ chunkSize: 4 bytes big-endian uint32 ]
[ baseIV: 12 bytes ]
[ chunk0Index: 4 bytes big-endian uint32 ]
[ chunk0Len: 4 bytes big-endian uint32 ]
[ chunk0 ciphertext: chunk0Len bytes ]
[ chunk0 tag: 16 bytes ]
[ chunk1Index: 4 bytes ]
[ chunk1Len: 4 bytes ]
[ chunk1 ciphertext ]
[ chunk1 tag ]
…
[ footerIndex: 4 bytes = 0xFFFFFFFF ]
[ footerLen: 4 bytes = 8 ]
[ footerCiphertext: 8 bytes big-endian uint64 = totalChunkCount ]
[ footerTag: 16 bytes ]
```

- `version` (`0x02`) lets us rotate algorithms later without guessing.
- `chunkSize` is the maximum plaintext bytes per chunk (default 64 KB). The final chunk may be smaller.
- `baseIV` is generated per file with `randomBytes(12)`.
- Chunk `n` uses a derived IV: the last 4 bytes of `baseIV` are incremented by `n` (big-endian), with carry wrapping within those 4 bytes. This guarantees unique IVs per chunk. The format supports up to `2^32` chunks; a chunk index at or above `2^32` is an error.
- Each chunk carries its own 16-byte AES-256-GCM auth tag. A chunk is verified before any of its plaintext is released.
- A **footer chunk** with index `0xFFFFFFFF` is written after the last data chunk. It authenticates the total chunk count. This detects truncation at a chunk boundary: if the last data chunk is removed, the footer is missing and decryption fails. The footer produces no plaintext.
- Files keep the existing sharded UUID path and have **no extension**.

### Key material

Reuse the existing key derivation in `src/lib/server/crypto.ts` (`ROAMARR_SECRET` → 32-byte AES key). Add a binary variant that returns a `Buffer` key rather than re-deriving independently. Optionally derive an attachment-specific subkey with `scryptSync(key(), 'roamarr.attachments.v1', 32)` for domain separation.

### Encryption flow (streaming)

1. Generate `baseIV` and pick `chunkSize` (64 KB default).
2. Open a write stream to a temp ciphertext path (`<final>.tmp`).
3. Write the header: version byte, `chunkSize`, and `baseIV`.
4. For each plaintext chunk from the upload `ReadableStream`:
   - Derive the chunk IV from `baseIV` + chunk index.
   - Encrypt with `createCipheriv('aes-256-gcm', key, chunkIV)`.
   - Write chunk index, ciphertext length, ciphertext, and auth tag.
   - Count actual plaintext bytes and chunks; fail immediately if the running total exceeds the configured maximum.
5. Write the footer chunk (index `0xFFFFFFFF`, total chunk count).
6. `fsync` the temp ciphertext file and atomically rename it to the final sharded path.
7. Clean up the temp file on any failure.
8. Return the `storageKey`, actual `plaintextBytes`, and `chunkCount` to the caller.

### Decryption flow (streaming without plaintext temp files)

AES-256-GCM cannot verify a flat stream until the entire ciphertext is processed. To avoid releasing unauthenticated plaintext and to avoid writing a plaintext temp file, we use chunked encryption: each chunk is verified independently before its plaintext is released. A footer authenticates the total chunk count so truncation at a chunk boundary is detected.

1. Open a read stream from the ciphertext file.
2. Read and validate the header (version, chunkSize, baseIV).
3. Return a Node.js `Readable` produced by `Readable.from(asyncGenerator)`, where the async generator consumes the ciphertext stream and yields verified plaintext chunks:
   - Read chunk index, ciphertext length, ciphertext, and tag.
   - If index is `0xFFFFFFFF`, verify the footer tag and total chunk count, then end the generator.
   - Derive the chunk IV.
   - Decrypt and verify the tag with `createDecipheriv('aes-256-gcm', key, chunkIV)`.
   - If verification succeeds, yield plaintext.
   - If verification fails or the footer is missing/invalid, throw.
4. The caller converts this to a web `ReadableStream` and sends it to the client.

No plaintext file is ever written to disk during download.

**Truncation behavior:** Tampering within a chunk fails immediately when that chunk is verified. Truncation at a chunk boundary is detected only when the footer is reached (or EOF before footer). Because plaintext is streamed chunk-by-chunk, the client may receive some bytes before a late truncation error is raised. This is the inherent trade-off between bounded-memory streaming and whole-file pre-authentication.

### Memory and disk bounds

- Encryption and decryption both use bounded chunk-sized buffers in memory.
- The only temporary file on disk is the ciphertext `.tmp` during upload, removed on failure.
- Because each chunk is authenticated independently, the client never receives bytes that fail authentication.
- Default upload limit is **10 MB**.

### Database schema

Add a generic `attachments` table and update `trip_expense_attachments` to reference it.

`attachments` columns:
- `id` primary key
- `owner_id` (the user who uploaded it; used for basic ownership, not authorization)
- `storage_key` unique
- `filename`
- `content_type`
- `size_bytes`
- `context` JSON (e.g. `{ kind: 'expense_receipt', tripId, expenseId }`)
- `created_at`

`trip_expense_attachments` columns (keep existing, add):
- `attachment_id` foreign key to `attachments.id`

The generic table lets future features (Documents file uploads, trip photos, etc.) reuse encrypted storage without another rewrite. `trip_expense_attachments` remains the context-specific join table that links an attachment to an expense.

### Authorization

`attachmentService` does **not** enforce authorization. It validates input, stores metadata, writes audit logs, and delegates storage. Callers (e.g., `tripExpenseAttachments`) perform context-specific authorization (`requireEditableTrip`) before calling the service.

This avoids the bug where a trip editor uploads a receipt and the trip owner is later denied access because `owner_id` does not match.

### Backward compatibility

Since Roamarr has no production users, no migration is needed. New files use version 2; legacy ciphertext files do not exist in the wild. Any local dev/test plaintext attachments should be removed before testing.

---

## Task 1: Update `getAttachmentsPath` to respect `ATTACHMENTS_PATH`

**Files:**
- Modify: `src/lib/server/paths.ts`
- Test: `src/lib/server/paths.test.ts` (add or update)

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, describe } from 'vitest';

describe('getAttachmentsPath', () => {
	test('respects ATTACHMENTS_PATH env var', async () => {
		const original = process.env.ATTACHMENTS_PATH;
		process.env.ATTACHMENTS_PATH = '/custom/attachments';
		const { getAttachmentsPath } = await import('./paths');
		expect(getAttachmentsPath()).toBe('/custom/attachments');
		process.env.ATTACHMENTS_PATH = original;
	});

	test('falls back beside a database file path', async () => {
		delete process.env.ATTACHMENTS_PATH;
		const original = process.env.DATABASE_PATH;
		process.env.DATABASE_PATH = '/data/roamarr-db/db.kitdb';
		const { getAttachmentsPath } = await import('./paths');
		expect(getAttachmentsPath()).toBe('/data/roamarr-db/attachments');
		process.env.DATABASE_PATH = original;
	});

	test('falls back inside a database directory path', async () => {
		delete process.env.ATTACHMENTS_PATH;
		const original = process.env.DATABASE_PATH;
		process.env.DATABASE_PATH = '/data/roamarr-db';
		const { getAttachmentsPath } = await import('./paths');
		expect(getAttachmentsPath()).toBe('/data/roamarr-db/attachments');
		process.env.DATABASE_PATH = original;
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk npx vitest run src/lib/server/paths.test.ts`
Expected: FAIL — current `getAttachmentsPath` ignores `ATTACHMENTS_PATH` and does not handle directory paths.

- [ ] **Step 3: Update `paths.ts`**

```ts
import path from 'node:path';
import { DEFAULT_KIT_DATABASE_PATH, getDatabasePath } from './db/paths';

export { DEFAULT_KIT_DATABASE_PATH as DEFAULT_DATABASE_PATH, getDatabasePath };

function isDatabaseFilePath(p: string): boolean {
	return /\.(db|sqlite|kitdb)$/i.test(path.basename(p));
}

export function getAttachmentsPath() {
	if (process.env.ATTACHMENTS_PATH) {
		return process.env.ATTACHMENTS_PATH;
	}
	const dbPath = getDatabasePath();
	const baseDir = isDatabaseFilePath(dbPath) ? path.dirname(dbPath) : dbPath;
	return path.join(baseDir, 'attachments');
}
```

- [ ] **Step 4: Align `restore.ts` with the same logic**

In `src/lib/server/restore.ts`, replace the local `getAttachmentsPath` implementation with an import from `../paths` (or duplicate the same directory/file detection). Ensure restore tests still pass.

- [ ] **Step 5: Run test to verify it passes**

Run: `rtk npx vitest run src/lib/server/paths.test.ts src/lib/server/restore.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/paths.ts src/lib/server/paths.test.ts src/lib/server/restore.ts
git commit -m "fix: getAttachmentsPath respects ATTACHMENTS_PATH and database directory paths"
```

---

## Task 2: Add binary AES key helper to existing crypto module

**Files:**
- Modify: `src/lib/server/crypto.ts`
- Test: `src/lib/server/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';

describe('crypto key', () => {
	it('returns a 32-byte buffer for aesKey', async () => {
		const { aesKey } = await import('./crypto');
		expect(aesKey()).toBeInstanceOf(Buffer);
		expect(aesKey().length).toBe(32);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk npx vitest run src/lib/server/crypto.test.ts`
Expected: FAIL — `aesKey` is not exported.

- [ ] **Step 3: Export the AES key function**

```ts
export function aesKey(): Buffer {
	return key();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk npx vitest run src/lib/server/crypto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/crypto.ts src/lib/server/crypto.test.ts
git commit -m "feat: expose aesKey helper for binary encryption"
```

---

## Task 3: Implement chunked streaming attachment crypto

**Files:**
- Create: `src/lib/server/attachments/attachmentCrypto.ts`
- Create: `src/lib/server/attachments/attachmentCrypto.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/attachments/attachmentCrypto.test.ts`:

```ts
import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	encryptChunkedFile,
	decryptChunkedFileStream,
	CHUNK_SIZE,
	INDEX_LENGTH,
	LEN_LENGTH,
	TAG_LENGTH
} from './attachmentCrypto';

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
	const chunks: Buffer[] = [];
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(Buffer.from(value));
	}
	return Buffer.concat(chunks);
}

function streamFromBuffer(b: Buffer | string): ReadableStream<Uint8Array> {
	const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new Uint8Array(buf));
			controller.close();
		}
	});
}

function streamFromBufferChunks(b: Buffer, chunkSize: number): ReadableStream<Uint8Array> {
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			if (offset >= b.length) {
				controller.close();
				return;
			}
			const end = Math.min(b.length, offset + chunkSize);
			controller.enqueue(new Uint8Array(b.subarray(offset, end)));
			offset = end;
		}
	});
}

describe('attachmentCrypto', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'roamarr-attach-'));
		process.env.ROAMARR_SECRET = 'ACpm0VlkwltJpcNWtxlilgjX+ZbW2nTV7QqYbZK0Fig=';
	});
	afterEach(() => {
		if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
	});

	test('round-trips a small file', async () => {
		const plain = 'hello encrypted world';
		const cipherPath = path.join(dir, 'cipher');
		await encryptChunkedFile(streamFromBuffer(plain), cipherPath);
		const out = await streamToBuffer(await decryptChunkedFileStream(cipherPath));
		expect(out.toString('utf8')).toBe(plain);
	});

	test('round-trips a 1 MB file', async () => {
		const plain = Buffer.alloc(1024 * 1024, 'a');
		const cipherPath = path.join(dir, 'cipher');
		await encryptChunkedFile(streamFromBufferChunks(plain, 8192), cipherPath);
		const out = await streamToBuffer(await decryptChunkedFileStream(cipherPath));
		expect(out.equals(plain)).toBe(true);
	});

	test('round-trips an empty file', async () => {
		const cipherPath = path.join(dir, 'cipher');
		await encryptChunkedFile(streamFromBuffer(''), cipherPath);
		const out = await streamToBuffer(await decryptChunkedFileStream(cipherPath));
		expect(out.length).toBe(0);
	});

	test('round-trips a file that spans multiple chunks', async () => {
		const plain = Buffer.alloc(CHUNK_SIZE * 3 + 17, 'x');
		const cipherPath = path.join(dir, 'cipher');
		await encryptChunkedFile(streamFromBufferChunks(plain, CHUNK_SIZE), cipherPath);
		const out = await streamToBuffer(await decryptChunkedFileStream(cipherPath));
		expect(out.equals(plain)).toBe(true);
	});

	test('reports actual plaintext bytes and chunk count', async () => {
		const plain = Buffer.alloc(CHUNK_SIZE + 100, 'y');
		const cipherPath = path.join(dir, 'cipher');
		const result = await encryptChunkedFile(streamFromBuffer(plain), cipherPath);
		expect(result.plaintextBytes).toBe(plain.length);
		expect(result.chunkCount).toBe(2);
	});

	test('enforces maxBytes during encryption', async () => {
		const plain = Buffer.alloc(100);
		const cipherPath = path.join(dir, 'cipher');
		await expect(
			encryptChunkedFile(streamFromBuffer(plain), cipherPath, { maxBytes: 50 })
		).rejects.toThrow();
	});

	test('tampered chunk fails decryption', async () => {
		const plain = 'secret';
		const cipherPath = path.join(dir, 'cipher');
		await encryptChunkedFile(streamFromBuffer(plain), cipherPath);
		const bytes = readFileSync(cipherPath);
		// Flip a byte well inside the first chunk body.
		bytes[30] ^= 0xff;
		writeFileSync(cipherPath, bytes);
		await expect(streamToBuffer(await decryptChunkedFileStream(cipherPath))).rejects.toThrow();
	});

	test('truncated final tag fails decryption', async () => {
		const plain = 'secret';
		const cipherPath = path.join(dir, 'cipher');
		await encryptChunkedFile(streamFromBuffer(plain), cipherPath);
		const bytes = readFileSync(cipherPath);
		writeFileSync(cipherPath, bytes.subarray(0, bytes.length - 4));
		await expect(streamToBuffer(await decryptChunkedFileStream(cipherPath))).rejects.toThrow();
	});

	test('truncation at a chunk boundary fails decryption', async () => {
		const plain = Buffer.alloc(CHUNK_SIZE * 2, 'z');
		const cipherPath = path.join(dir, 'cipher');
		await encryptChunkedFile(streamFromBuffer(plain), cipherPath);
		const bytes = readFileSync(cipherPath);
		// Drop the last complete data chunk and the footer.
		const footerStart = findFooterStart(bytes);
		expect(footerStart).toBeGreaterThan(0);
		const chunkStart = findPreviousChunkStart(bytes, footerStart);
		writeFileSync(cipherPath, bytes.subarray(0, chunkStart));
		await expect(streamToBuffer(await decryptChunkedFileStream(cipherPath))).rejects.toThrow();
	});

	test('encrypted file has version 2 header', async () => {
		const cipherPath = path.join(dir, 'cipher');
		await encryptChunkedFile(streamFromBuffer('x'), cipherPath);
		const bytes = readFileSync(cipherPath);
		expect(bytes[0]).toBe(2);
		expect(bytes.length).toBeGreaterThan(1 + 4 + 12 + 4 + 4 + 16 + 1);
	});
});

function findFooterStart(bytes: Buffer): number {
	// Footer index sentinel is 0xFFFFFFFF. Search backward for the length pattern.
	for (let i = bytes.length - TAG_LENGTH - LEN_LENGTH; i >= HEADER_LENGTH + INDEX_LENGTH + LEN_LENGTH; i--) {
		if (bytes.readUInt32BE(i - INDEX_LENGTH) === 0xffffffff && bytes.readUInt32BE(i) === 8) {
			return i - INDEX_LENGTH;
		}
	}
	return -1;
}

function findPreviousChunkStart(bytes: Buffer, footerStart: number): number {
	// Walk back one chunk record from the footer start.
	let pos = footerStart;
	// Skip footer index, len, ciphertext (8), tag.
	pos -= TAG_LENGTH + 8 + LEN_LENGTH + INDEX_LENGTH;
	if (pos < HEADER_LENGTH) return HEADER_LENGTH;
	const len = bytes.readUInt32BE(pos);
	pos -= len + LEN_LENGTH + INDEX_LENGTH;
	return Math.max(HEADER_LENGTH, pos);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk npx vitest run src/lib/server/attachments/attachmentCrypto.test.ts`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement chunked streaming crypto**

Create `src/lib/server/attachments/attachmentCrypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { aesKey } from '../crypto';

export const VERSION = 2;
export const CHUNK_SIZE = 64 * 1024;
export const IV_LENGTH = 12;
export const TAG_LENGTH = 16;
export const INDEX_LENGTH = 4;
export const LEN_LENGTH = 4;
export const HEADER_LENGTH = 1 + LEN_LENGTH + IV_LENGTH;
export const FOOTER_INDEX = 0xffffffff;

function attachmentKey(): Buffer {
	return scryptSync(aesKey(), 'roamarr.attachments.v1', 32);
}

function deriveChunkIV(baseIV: Buffer, index: number): Buffer {
	if (index >= 2 ** 32) {
		throw new Error('attachment chunk index overflow');
	}
	const iv = Buffer.from(baseIV);
	const counter = iv.readUInt32BE(IV_LENGTH - 4);
	iv.writeUInt32BE((counter + index) >>> 0, IV_LENGTH - 4);
	return iv;
}

async function* chunkStream(input: ReadableStream<Uint8Array>, chunkSize: number) {
	const reader = input.getReader();
	let buffer = Buffer.alloc(0);
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (value) {
				buffer = Buffer.concat([buffer, Buffer.from(value)]);
			}
			while (buffer.length >= chunkSize || (done && buffer.length > 0)) {
				const take = Math.min(chunkSize, buffer.length);
				yield buffer.subarray(0, take);
				buffer = buffer.subarray(take);
			}
			if (done) break;
		}
	} finally {
		reader.releaseLock();
	}
}

async function writeChunk(
	output: ReturnType<typeof createWriteStream>,
	baseIV: Buffer,
	index: number,
	plainChunk: Buffer
): Promise<void> {
	const iv = deriveChunkIV(baseIV, index);
	const cipher = createCipheriv('aes-256-gcm', attachmentKey(), iv);
	const cipherChunk = Buffer.concat([cipher.update(plainChunk), cipher.final()]);
	const tag = cipher.getAuthTag();

	const idxBuf = Buffer.alloc(INDEX_LENGTH);
	idxBuf.writeUInt32BE(index, 0);

	const lenBuf = Buffer.alloc(LEN_LENGTH);
	lenBuf.writeUInt32BE(cipherChunk.length, 0);

	await new Promise<void>((resolve, reject) => {
		output.write(Buffer.concat([idxBuf, lenBuf, cipherChunk, tag]), (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

export interface EncryptResult {
	plaintextBytes: number;
	chunkCount: number;
}

export interface EncryptOptions {
	maxBytes?: number;
}

export async function encryptChunkedFile(
	input: ReadableStream<Uint8Array>,
	outputPath: string,
	options: EncryptOptions = {}
): Promise<EncryptResult> {
	const { maxBytes = Number.MAX_SAFE_INTEGER } = options;
	const baseIV = randomBytes(IV_LENGTH);
	const tempPath = `${outputPath}.tmp`;
	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	const output = createWriteStream(tempPath);

	await new Promise<void>((resolve, reject) => {
		const sizeBuf = Buffer.alloc(LEN_LENGTH);
		sizeBuf.writeUInt32BE(CHUNK_SIZE, 0);
		output.write(Buffer.concat([Buffer.from([VERSION]), sizeBuf, baseIV]), (err) => {
			if (err) reject(err);
			else resolve();
		});
	});

	let index = 0;
	let plaintextBytes = 0;
	try {
		for await (const plainChunk of chunkStream(input, CHUNK_SIZE)) {
			plaintextBytes += plainChunk.length;
			if (plaintextBytes > maxBytes) {
				throw new Error('attachment exceeds maximum allowed size');
			}
			await writeChunk(output, baseIV, index, plainChunk);
			index++;
		}

		// Footer authenticates total chunk count.
		const footerPlain = Buffer.alloc(8);
		footerPlain.writeBigUInt64BE(BigInt(index), 0);
		await writeChunk(output, baseIV, FOOTER_INDEX, footerPlain);

		await new Promise<void>((resolve, reject) => {
			output.on('finish', resolve);
			output.on('error', reject);
			output.end();
		});

		const handle = await fs.open(tempPath, 'r+');
		await handle.sync();
		await handle.close();
		await fs.rename(tempPath, outputPath);

		return { plaintextBytes, chunkCount: index };
	} catch (e) {
		output.destroy();
		try {
			await fs.unlink(tempPath);
		} catch {
			// ignore cleanup failure
		}
		throw e;
	}
}

export async function decryptChunkedFileStream(cipherPath: string): Promise<ReadableStream<Uint8Array>> {
	const source = createReadStream(cipherPath);

	async function* decryptChunks() {
		const header = await readExactly(source, HEADER_LENGTH);
		if (header.length < HEADER_LENGTH) {
			throw new Error('attachment ciphertext header truncated');
		}
		if (header[0] !== VERSION) {
			throw new Error(`unsupported attachment encryption version: ${header[0]}`);
		}
		const chunkSize = header.readUInt32BE(1);
		const baseIV = header.subarray(1 + LEN_LENGTH, HEADER_LENGTH);

		let dataChunkCount = 0;
		while (true) {
			const idxBuf = await readExactly(source, INDEX_LENGTH);
			if (idxBuf.length === 0) {
				throw new Error('attachment footer missing');
			}
			if (idxBuf.length < INDEX_LENGTH) {
				throw new Error('attachment chunk index truncated');
			}

			const lenBuf = await readExactly(source, LEN_LENGTH);
			if (lenBuf.length < LEN_LENGTH) {
				throw new Error('attachment chunk length truncated');
			}
			const chunkLen = lenBuf.readUInt32BE(0);

			const cipherChunk = await readExactly(source, chunkLen);
			if (cipherChunk.length < chunkLen) {
				throw new Error('attachment chunk ciphertext truncated');
			}

			const tag = await readExactly(source, TAG_LENGTH);
			if (tag.length < TAG_LENGTH) {
				throw new Error('attachment chunk tag truncated');
			}

			const index = idxBuf.readUInt32BE(0);
			if (index === FOOTER_INDEX) {
				const iv = deriveChunkIV(baseIV, FOOTER_INDEX);
				const decipher = createDecipheriv('aes-256-gcm', attachmentKey(), iv);
				decipher.setAuthTag(tag);
				const footerPlain = Buffer.concat([decipher.update(cipherChunk), decipher.final()]);
				const expectedCount = Number(footerPlain.readBigUInt64BE(0));
				if (expectedCount !== dataChunkCount) {
					throw new Error(`attachment chunk count mismatch: expected ${expectedCount}, got ${dataChunkCount}`);
				}
				return;
			}

			if (index !== dataChunkCount) {
				throw new Error(`attachment chunk out of order: expected ${dataChunkCount}, got ${index}`);
			}

			const iv = deriveChunkIV(baseIV, index);
			const decipher = createDecipheriv('aes-256-gcm', attachmentKey(), iv);
			decipher.setAuthTag(tag);
			const plain = Buffer.concat([decipher.update(cipherChunk), decipher.final()]);
			yield plain;
			dataChunkCount++;
		}
	}

	const nodeReadable = Readable.from(decryptChunks(), { objectMode: false });
	nodeReadable.on('error', () => source.destroy());
	return Readable.toWeb(nodeReadable) as ReadableStream<Uint8Array>;
}

function readExactly(stream: ReturnType<typeof createReadStream>, n: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		let buf = Buffer.alloc(0);

		function onData(data: Buffer) {
			buf = Buffer.concat([buf, data]);
			if (buf.length >= n) {
				cleanup();
				const result = buf.subarray(0, n);
				if (buf.length > n) {
					stream.unshift(buf.subarray(n));
				}
				resolve(result);
			}
		}

		function onEnd() {
			cleanup();
			resolve(buf);
		}

		function onError(err: Error) {
			cleanup();
			reject(err);
		}

		function cleanup() {
			stream.off('data', onData);
			stream.off('end', onEnd);
			stream.off('error', onError);
		}

		stream.on('data', onData);
		stream.on('end', onEnd);
		stream.on('error', onError);
		stream.resume();
	});
}
```

> **Note:** The `readExactly` helper unshifts excess bytes so chunk boundaries align. The async-generator approach avoids concurrent `_read` calls and backpressure issues. The implementing agent must verify stream cleanup when the client disconnects mid-download. The footer is treated as a normal chunk with a sentinel index so the same code paths authenticate it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk npx vitest run src/lib/server/attachments/attachmentCrypto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/attachments/attachmentCrypto.ts src/lib/server/attachments/attachmentCrypto.test.ts
git commit -m "feat: chunked AES-256-GCM attachment crypto without plaintext temp files"
```

---

## Task 4: Implement attachment storage layer

**Files:**
- Create: `src/lib/server/attachments/attachmentStorage.ts`
- Create: `src/lib/server/attachments/attachmentStorage.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/attachments/attachmentStorage.test.ts`:

```ts
import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
	saveEncryptedAttachment,
	readEncryptedAttachmentStream,
	deleteEncryptedAttachment,
	attachmentPath
} from './attachmentStorage';

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
	const chunks: Buffer[] = [];
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(Buffer.from(value));
	}
	return Buffer.concat(chunks);
}

describe('attachmentStorage', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'roamarr-storage-'));
		process.env.ROAMARR_SECRET = 'ACpm0VlkwltJpcNWtxlilgjX+ZbW2nTV7QqYbZK0Fig=';
	});
	afterEach(() => {
		if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
	});

	function streamFromString(s: string): ReadableStream<Uint8Array> {
		return new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(Buffer.from(s)));
				controller.close();
			}
		});
	}

	test('saveEncryptedAttachment returns a sharded uuid path and byte count', async () => {
		const result = await saveEncryptedAttachment(streamFromString('hello'), dir);
		expect(result.storageKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
		expect(result.plaintextBytes).toBe(5);
		const p = attachmentPath(result.storageKey, dir);
		expect(existsSync(p)).toBe(true);
		expect(p).toContain(path.join(result.storageKey.slice(0, 2), result.storageKey.slice(2, 4), result.storageKey));
	});

	test('readEncryptedAttachmentStream decrypts to a stream', async () => {
		const plain = 'stored securely';
		const { storageKey } = await saveEncryptedAttachment(streamFromString(plain), dir);
		const stream = await readEncryptedAttachmentStream(storageKey, dir);
		const out = await streamToBuffer(stream);
		expect(out.toString('utf8')).toBe(plain);
	});

	test('deleteEncryptedAttachment removes the ciphertext file', async () => {
		const { storageKey } = await saveEncryptedAttachment(streamFromString('x'), dir);
		const p = attachmentPath(storageKey, dir);
		expect(existsSync(p)).toBe(true);
		deleteEncryptedAttachment(storageKey, dir);
		expect(existsSync(p)).toBe(false);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk npx vitest run src/lib/server/attachments/attachmentStorage.test.ts`
Expected: FAIL — storage functions not defined.

- [ ] **Step 3: Implement storage layer**

Create `src/lib/server/attachments/attachmentStorage.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk npx vitest run src/lib/server/attachments/attachmentStorage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/attachments/attachmentStorage.ts src/lib/server/attachments/attachmentStorage.test.ts
git commit -m "feat: sharded encrypted attachment storage layer"
```

---

## Task 5: Add generic attachments schema and migration

**Files:**
- Modify: `src/lib/server/db/mongrelSchema.ts`
- Create: `src/lib/server/db/mongrelMigrations/00XX_attachments_table.ts`

- [ ] **Step 1: Add `attachments` table to schema**

In `src/lib/server/db/mongrelSchema.ts`, add near `tripExpenseAttachments`:

```ts
export const attachments = table('attachments', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('attachments_id_seq') }),
		int('owner_id'),
		text('storage_key'),
		text('filename'),
		text('content_type'),
		int('size_bytes', { default: staticDefault(0n) }),
		json('context'),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	unique: [unique(['storage_key'], { name: 'attachments_storage_key_uq' })],
	indexes: [index(['owner_id'], { name: 'attachments_owner_idx' })],
	foreignKeys: [
		foreignKey(
			['owner_id'],
			{ table: 'users', columns: ['id'] },
			{ name: 'fk_attachments_owner_id_users', onDelete: 'cascade' }
		)
	]
});
```

Add `attachments` to the schema export list immediately before `tripExpenseAttachments`, and ensure the `new Schema([...])` constructor lists `attachments` before `tripExpenseAttachments` so foreign-key creation order is consistent.

- [ ] **Step 2: Update `trip_expense_attachments` to reference attachments**

Change `trip_expense_attachments` columns to:

```ts
export const tripExpenseAttachments = table('trip_expense_attachments', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_expense_attachments_id_seq') }),
		int('expense_id'),
		int('attachment_id'),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	unique: [unique(['attachment_id'], { name: 'trip_expense_attachments_attachment_id_uq' })],
	indexes: [index(['expense_id'], { name: 'expense_attachments_expense_idx' })],
	foreignKeys: [
		foreignKey(
			['expense_id'],
			{ table: 'trip_expenses', columns: ['id'] },
			{ name: 'fk_trip_expense_attachments_expense_id_trip_expenses', onDelete: 'cascade' }
		),
		foreignKey(
			['attachment_id'],
			{ table: 'attachments', columns: ['id'] },
			{ name: 'fk_trip_expense_attachments_attachment_id_attachments', onDelete: 'cascade' }
		)
	]
});
```

- [ ] **Step 3: Write migration**

Create `src/lib/server/db/mongrelMigrations/0013_attachments_table.ts`:

```ts
import type { Migration } from '@visorcraft/mongreldb-kit';
import { attachments, tripExpenseAttachments } from '../mongrelSchema';

const attachmentsTableMigration: Migration = {
	version: 13,
	name: 'attachments_table',
	up: (ctx) => {
		// The old trip_expense_attachments table stored attachment metadata inline.
		// We are replacing it with a generic attachments table and a link table.
		// Since Roamarr has no production users, dropping the old table is acceptable.
		ctx.kit.sql('DROP TABLE IF EXISTS trip_expense_attachments');
		ctx.ensureTable(attachments);
		ctx.ensureTable(tripExpenseAttachments);
	}
};

export const migrations = [attachmentsTableMigration];
```

- [ ] **Step 3b: Register the migration**

In `src/lib/server/db/mongrelMigrations/index.ts`, import and append the new migration:

```ts
import { migrations as migrations0013 } from './0013_attachments_table';

export const migrations: Migration[] = [
	// ... existing migrations ...,
	...migrations0013
];
```

- [ ] **Step 4: Run type check**

Run: `rtk npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/db/mongrelSchema.ts src/lib/server/db/mongrelMigrations/00XX_attachments_table.ts
git commit -m "feat: generic attachments table and expense attachment link table"
```

---

## Task 6: Build generic attachment service

**Files:**
- Create: `src/lib/server/attachments/attachmentRepo.ts`
- Create: `src/lib/server/attachments/attachmentService.ts`
- Create: `src/lib/server/attachments/attachmentService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/attachments/attachmentService.test.ts`:

```ts
import { test, expect, describe, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('../db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	createAttachment,
	readAttachmentStream,
	deleteAttachment
} from './attachmentService';
import { attachments as attachmentsTable } from '../db/mongrelSchema';
import { eq, type KitDatabase } from '@visorcraft/mongreldb-kit';
import { makeSyncedUser } from '../../../../tests/helpers';

async function streamToBuffer(stream: ReadableStream): Promise<Buffer> {
	const chunks: Buffer[] = [];
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(Buffer.from(value));
	}
	return Buffer.concat(chunks);
}

function getKit(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

describe('attachmentService', () => {
	let baseDir: string;
	let userId: number;

	beforeEach(() => {
		baseDir = mkdtempSync(path.join(tmpdir(), 'roamarr-svc-'));
		process.env.ATTACHMENTS_PATH = baseDir;
		process.env.ROAMARR_SECRET = 'ACpm0VlkwltJpcNWtxlilgjX+ZbW2nTV7QqYbZK0Fig=';
		const kit = getKit();
		kit.deleteFrom(attachmentsTable).executeSync();
		const u = makeSyncedUser(kit, { email: 'a@b.c', passwordHash: 'x', displayName: 'A' });
		userId = Number(u.id);
	});

	afterEach(() => {
		if (existsSync(baseDir)) rmSync(baseDir, { recursive: true, force: true });
	});

	function fileFromString(s: string, name: string, type: string) {
		return new File([s], name, { type });
	}

	test('createAttachment stores metadata and ciphertext', async () => {
		const file = fileFromString('hello', 'note.txt', 'text/plain');
		const att = await createAttachment({ ownerId: userId, file, context: { kind: 'test' } });
		expect(att.filename).toBe('note.txt');
		expect(att.contentType).toBe('text/plain');
		expect(att.sizeBytes).toBe(5);
		expect(att.storageKey).toBeTruthy();
	});

	test('readAttachmentStream decrypts the stored file', async () => {
		const file = fileFromString('round trip', 'note.txt', 'text/plain');
		const att = await createAttachment({ ownerId: userId, file, context: { kind: 'test' } });
		const stream = await readAttachmentStream(att.id);
		const out = await streamToBuffer(stream);
		expect(out.toString('utf8')).toBe('round trip');
	});

	test('deleteAttachment removes row and ciphertext', async () => {
		const file = fileFromString('x', 'x.txt', 'text/plain');
		const att = await createAttachment({ ownerId: userId, file, context: { kind: 'test' } });
		await deleteAttachment(att.id);
		const kit = getKit();
		const rows = kit.selectFrom(attachmentsTable).where(eq(attachmentsTable.id, BigInt(att.id))).executeSync();
		expect(rows).toHaveLength(0);
	});

	test('rejects disallowed content types', async () => {
		const file = fileFromString('x', 'x.exe', 'application/x-msdownload');
		await expect(createAttachment({ ownerId: userId, file, context: {} })).rejects.toMatchObject({ status: 400 });
	});

	test('rejects oversized files', async () => {
		const file = fileFromString('x'.repeat(10 * 1024 * 1024 + 1), 'x.png', 'image/png');
		await expect(createAttachment({ ownerId: userId, file, context: {} })).rejects.toMatchObject({ status: 400 });
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk npx vitest run src/lib/server/attachments/attachmentService.test.ts`
Expected: FAIL — repo and service not defined.

- [ ] **Step 3: Implement attachment repo**

Create `src/lib/server/attachments/attachmentRepo.ts`:

```ts
import { attachments } from '../db/mongrelSchema';
import { getDb } from '../db';
import { eq } from '@visorcraft/mongreldb-kit';

export interface AttachmentInsert {
	ownerId: number;
	storageKey: string;
	filename: string;
	contentType: string;
	sizeBytes: number;
	context: Record<string, unknown>;
}

export interface AttachmentRecord {
	id: number;
	ownerId: number;
	storageKey: string;
	filename: string;
	contentType: string;
	sizeBytes: number;
	context: Record<string, unknown>;
	createdAt: Date | string;
}

function mapRow(row: Record<string, unknown>): AttachmentRecord {
	return {
		id: Number(row.id),
		ownerId: Number(row.owner_id),
		storageKey: String(row.storage_key),
		filename: String(row.filename),
		contentType: String(row.content_type),
		sizeBytes: Number(row.size_bytes),
		context: typeof row.context === 'string' ? JSON.parse(row.context) : (row.context ?? {}),
		createdAt: row.created_at as Date | string
	};
}

export function createAttachment(input: AttachmentInsert): AttachmentRecord {
	const db = getDb();
	const row = db
		.insertInto(attachments)
		.values({
			owner_id: BigInt(input.ownerId),
			storage_key: input.storageKey,
			filename: input.filename,
			content_type: input.contentType,
			size_bytes: BigInt(input.sizeBytes),
			context: JSON.stringify(input.context)
		})
		.executeSync();
	return mapRow(row);
}

export function getAttachmentById(id: number): AttachmentRecord | null {
	const db = getDb();
	const row = db.selectFrom(attachments).where(eq(attachments.id, BigInt(id))).executeSync()[0];
	if (!row) return null;
	return mapRow(row);
}

export function deleteAttachment(id: number): void {
	const db = getDb();
	db.deleteFrom(attachments).where(eq(attachments.id, BigInt(id))).executeSync();
}
```

- [ ] **Step 4: Implement attachment service**

Create `src/lib/server/attachments/attachmentService.ts`:

```ts
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
	// Stage to a temp key so the ciphertext file is not orphaned if the DB insert fails.
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

	const row = repo.createAttachment({
		ownerId,
		storageKey: finalKey,
		filename: file.name,
		contentType: file.type,
		sizeBytes: plaintextBytes,
		context
	});

	// Move the staged ciphertext to its final storage key only after the DB row exists.
	const finalPath = attachmentPath(finalKey, baseDir);
	await fs.mkdir(path.dirname(finalPath), { recursive: true });
	await fs.rename(stagingPath, finalPath);

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
	deleteEncryptedAttachment(row.storageKey, baseDir);
	repo.deleteAttachment(attachmentId);

	logAudit(row.ownerId, 'delete', 'attachment', attachmentId, {
		filename: row.filename
	});

	return row;
}
```

- [ ] **Step 5: Run tests**

Run: `rtk npx vitest run src/lib/server/attachments/attachmentService.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/attachments/attachmentService.ts src/lib/server/attachments/attachmentRepo.ts src/lib/server/attachments/attachmentService.test.ts
git commit -m "feat: generic encrypted attachment service without context-specific authorization"
```

---

## Task 7: Refactor expense attachments to use the generic service

**Files:**
- Modify: `src/lib/server/tripExpenseAttachments.ts`
- Modify: `src/lib/server/tripExpenseAttachments.test.ts`
- Modify: `src/lib/server/repositories/expensesRepo.ts`
- Modify: `src/lib/server/tripDetail.ts` (if it loads attachments)

- [ ] **Step 1: Add expense attachment link helpers to `expensesRepo.ts`**

Add to `src/lib/server/repositories/expensesRepo.ts`:

```ts
import { eq as kitEq, joinEq } from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import { tripExpenseAttachments, attachments } from '$lib/server/db/mongrelSchema';

function toBigInt(id: number): bigint {
	return BigInt(id);
}

export interface ExpenseAttachmentLink {
	id: number;
	expenseId: number;
	attachmentId: number;
	createdAt: Date | string;
}

export function createExpenseAttachmentLink(expenseId: number, attachmentId: number): ExpenseAttachmentLink {
	const db = kit;
	const row = db
		.insertInto(tripExpenseAttachments)
		.values({
			expense_id: BigInt(expenseId),
			attachment_id: BigInt(attachmentId)
		})
		.executeSync();
	return {
		id: Number(row.id),
		expenseId: Number(row.expense_id),
		attachmentId: Number(row.attachment_id),
		createdAt: row.created_at as Date | string
	};
}

export function getExpenseAttachmentLinkById(id: number): ExpenseAttachmentLink | null {
	const db = getDb();
	const row = db.selectFrom(tripExpenseAttachments).where(eq(tripExpenseAttachments.id, BigInt(id))).executeSync()[0];
	if (!row) return null;
	return {
		id: Number(row.id),
		expenseId: Number(row.expense_id),
		attachmentId: Number(row.attachment_id),
		createdAt: row.created_at as Date | string
	};
}

export interface AttachmentRow {
	id: number;          // trip_expense_attachments.id (matches URL parameter)
	attachmentId: number;
	filename: string;
	contentType: string;
	sizeBytes: number;
	createdAt: Date | string;
}

export function listAttachmentsForExpense(expenseId: number): AttachmentRow[] {
	const rows = kit
		.selectFrom(tripExpenseAttachments)
		.where(kitEq(tripExpenseAttachments.expense_id, toBigInt(expenseId)))
		.innerJoin(
			attachments,
			joinEq(
				tripExpenseAttachments,
				tripExpenseAttachments.attachment_id,
				attachments,
				attachments.id
			)
		)
		.executeSync();

	return rows
		.map((r) => {
			const link = r.trip_expense_attachments as Record<string, unknown>;
			const att = r.attachments as Record<string, unknown>;
			return {
				id: Number(link.id),
				attachmentId: Number(att.id),
				filename: String(att.filename),
				contentType: String(att.content_type),
				sizeBytes: Number(att.size_bytes),
				createdAt: att.created_at as Date | string
			};
		})
		.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function deleteExpenseAttachmentLink(id: number): void {
	const db = getDb();
	db.deleteFrom(tripExpenseAttachments).where(eq(tripExpenseAttachments.id, BigInt(id))).executeSync();
}
```

Update the existing `AttachmentRow` type in `expensesRepo.ts` to match the new shape.

- [ ] **Step 2: Update `tripExpenseAttachments.ts` to use generic service and trip auth**

Replace the file with:

```ts
import { error } from '@sveltejs/kit';
import * as expensesRepo from './repositories/expensesRepo';
import { requireEditableTrip } from './ownership';
import { logAudit } from './audit';
import { createAttachment, readAttachmentStream, deleteAttachment as deleteGenericAttachment } from './attachments/attachmentService';

export async function addAttachment(userId: number, expenseId: number, file: File) {
	const expense = expensesRepo.getExpenseById(expenseId);
	if (!expense) throw error(404, 'Expense not found');
	requireEditableTrip(userId, expense.tripId);

	const attachment = await createAttachment({
		ownerId: userId,
		file,
		context: { kind: 'expense_receipt', expenseId, tripId: expense.tripId }
	});

	const link = expensesRepo.createExpenseAttachmentLink(expenseId, attachment.id);

	logAudit(userId, 'create', 'trip_expense_attachment', link.id, {
		expenseId,
		attachmentId: attachment.id,
		filename: file.name
	});

	return { link, attachment };
}

export function listAttachments(expenseId: number) {
	return expensesRepo.listAttachmentsForExpense(expenseId);
}

export function getAttachmentLink(userId: number, linkId: number) {
	const link = expensesRepo.getExpenseAttachmentLinkById(linkId);
	if (!link) throw error(404, 'Attachment not found');
	const expense = expensesRepo.getExpenseById(link.expenseId);
	if (!expense) throw error(404, 'Expense not found');
	requireEditableTrip(userId, expense.tripId);
	return { link, tripId: expense.tripId };
}

export async function readAttachment(userId: number, linkId: number) {
	const { link, tripId } = getAttachmentLink(userId, linkId);
	const { stream, record } = await readAttachmentStream(link.attachmentId);
	return { stream, record, tripId, expenseId: link.expenseId, linkId };
}

export async function deleteAttachment(userId: number, linkId: number) {
	const { link, tripId } = getAttachmentLink(userId, linkId);
	const attachment = await deleteGenericAttachment(link.attachmentId);
	// The link row has ON DELETE CASCADE, but we delete it explicitly first
	// so the audit log and any future constraints remain obvious.
	expensesRepo.deleteExpenseAttachmentLink(link.id);
	logAudit(userId, 'delete', 'trip_expense_attachment', linkId, {
		expenseId: link.expenseId,
		attachmentId: link.attachmentId,
		filename: attachment.filename
	});
}
```

- [ ] **Step 3: Update `tripDetail.ts` to load attachments from the new shape**

Find any place that loads expense attachments and update field names to match the new `AttachmentRow` shape (`contentType`, `sizeBytes`, etc.).

- [ ] **Step 4: Update tests in `tripExpenseAttachments.test.ts`**

Update assertions to use the new `{ link, attachment }` return shape and the new `AttachmentRow` fields. Add a test that decrypts an uploaded file and verifies the plaintext via the stream.

- [ ] **Step 5: Run tests**

Run: `rtk npx vitest run src/lib/server/tripExpenseAttachments.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/tripExpenseAttachments.ts src/lib/server/tripExpenseAttachments.test.ts src/lib/server/repositories/expensesRepo.ts src/lib/server/tripDetail.ts
git commit -m "refactor: expense attachments use generic encrypted attachment service"
```

---

## Task 7b: Update attachment helpers and existing tests

**Files:**
- Modify: `tests/helpers.ts`
- Modify: `src/lib/server/repositories/expensesRepo.test.ts`
- Modify: `src/lib/server/tripExpenseAttachments.test.ts`

- [ ] **Step 1: Update `makeAttachment` in `tests/helpers.ts`**

Add `attachments` to the `tests/helpers.ts` import from `../src/lib/server/db/mongrelSchema`. Then change `makeAttachment` to insert into the generic `attachments` table and the `trip_expense_attachments` link table. Return the link row shape (`id` is the link id, `attachmentId` is the generic attachment id).

```ts
export function makeAttachment(
	kit: KitDatabase,
	over: Partial<Record<string, unknown>> = {}
) {
	const ownerId = BigInt((over.ownerId as number) ?? 0);
	const expenseId = BigInt((over.expenseId as number) ?? 0);
	const filename = (over.filename as string) ?? 'file.png';
	const storageKey = (over.storageKey as string) ?? 'key';
	const contentType = (over.contentType as string) ?? 'image/png';
	const sizeBytes = BigInt((over.sizeBytes as number) ?? 0);

	const att = kit.insertInto(attachments).values({
		owner_id: ownerId,
		storage_key: storageKey,
		filename,
		content_type: contentType,
		size_bytes: sizeBytes,
		context: '{}'
	}).executeSync();

	const link = kit.insertInto(tripExpenseAttachments).values({
		expense_id: expenseId,
		attachment_id: att.id
	}).executeSync();

	return {
		id: Number(link.id),
		attachmentId: Number(att.id),
		expenseId: Number(link.expense_id),
		filename,
		storageKey,
		contentType,
		sizeBytes: Number(sizeBytes),
		createdAt: link.created_at
	};
}
```

- [ ] **Step 2: Update `expensesRepo.test.ts` attachment CRUD test**

Replace the old `expensesRepo.createAttachment/getAttachmentById/deleteAttachment` calls with the new `createExpenseAttachmentLink`, `listAttachmentsForExpense`, and `deleteExpenseAttachmentLink` helpers. The cascade test can use `makeAttachment` from `tests/helpers.ts` or the new helpers.

- [ ] **Step 3: Update `tripExpenseAttachments.test.ts`**

- Change imports: remove `getAttachmentWithPath`.
- Update `addAttachment` assertions to expect `{ link, attachment }`.
- Use `process.env.ATTACHMENTS_PATH` pointing to a temp dir and clean it in `afterEach` instead of hard-coded `./attachments`.
- Replace `getAttachmentWithPath` usage with a call through `readAttachmentStream` and verify the decrypted bytes.
- Update the max-size test to expect 10 MB.

- [ ] **Step 4: Run tests**

Run: `rtk npx vitest run src/lib/server/repositories/expensesRepo.test.ts src/lib/server/tripExpenseAttachments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers.ts src/lib/server/repositories/expensesRepo.test.ts src/lib/server/tripExpenseAttachments.test.ts
git commit -m "test: update attachment helpers and tests for generic encrypted attachments"
```

---

## Task 8: Update download route to stream decrypted chunks

**Files:**
- Modify: `src/routes/trips/[id]/expenses/[expenseId]/attachments/[attachmentId]/+server.ts`

- [ ] **Step 1: Replace synchronous read with streaming chunked decryption**

```ts
import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { readAttachment } from '$lib/server/tripExpenseAttachments';
import type { RequestHandler } from './$types';

function sanitizeFilename(name: string): string {
	return name
		.replace(/[\x00-\x1f\x7f\\/"'\[\]{};:|<>?*]/g, '_')
		.replace(/\.{2,}/g, '_')
		.slice(0, 255);
}

export const GET: RequestHandler = async ({ locals, params }) => {
	const u = requireUser(locals);
	const tripId = Number(params.id);
	const expenseId = Number(params.expenseId);
	const linkId = Number(params.attachmentId);
	if (!Number.isFinite(tripId) || !Number.isFinite(expenseId) || !Number.isFinite(linkId)) {
		throw error(400, 'Invalid request');
	}

	const { stream, record, tripId: actualTripId, expenseId: actualExpenseId } = await readAttachment(u.id, linkId);
	if (actualTripId !== tripId || actualExpenseId !== expenseId) {
		throw error(404, 'Attachment not found');
	}

	const safeFilename = sanitizeFilename(record.filename);

	return new Response(stream, {
		headers: {
			'Content-Type': record.contentType,
			'Content-Disposition': `attachment; filename="${safeFilename}"`,
			'Content-Length': String(record.sizeBytes)
		}
	});
};
```

- [ ] **Step 2: Run type check**

Run: `rtk npm run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/trips/[id]/expenses/[expenseId]/attachments/[attachmentId]/+server.ts
git commit -m "feat: stream expense attachments as chunked decrypted bytes"
```

---

## Task 9: Update the upload form action

**Files:**
- Modify: `src/lib/server/tripMetaActions.ts`

- [ ] **Step 1: No change required**

The `addAttachmentAction` already passes the `File` object through. Because `createAttachment` in `attachmentService` accepts a `File` and calls `file.stream()`, no change is needed here.

- [ ] **Step 2: Verify with type check**

Run: `rtk npm run check`
Expected: PASS.

---

## Task 10: Update UI to show attachment data from new schema

**Files:**
- Modify: `src/routes/trips/[id]/+page.svelte`
- Modify: `src/routes/trips/[id]/+page.server.ts`

- [ ] **Step 1: Update data load to return attachments in new shape**

In `+page.server.ts`, ensure expense attachments are loaded with `id`, `attachmentId`, `filename`, `contentType`, `sizeBytes`.

- [ ] **Step 2: Update UI references**

In `+page.svelte`, update the attachment display to use the new field names. The existing code references `a.filename` and `a.sizeBytes`; verify `contentType` is available if used. Note that `AttachmentRow.id` is now the expense-attachment **link id**, which matches the `[attachmentId]` route parameter, so attachment URLs should continue to use `a.id`.

- [ ] **Step 3: Commit if changes are made**

```bash
git add src/routes/trips/[id]/+page.svelte src/routes/trips/[id]/+page.server.ts
git commit -m "fix: adapt expense attachment UI to generic attachment schema"
```

---

## Task 11: Add end-to-end coverage for encrypted upload/download

**Files:**
- Modify: `tests/e2e/expenses.spec.ts` or create `tests/e2e/attachments.spec.ts`

- [ ] **Step 1: Add a download integrity test**

Use the existing `createTrip` helper from `tests/e2e/helpers.ts`.

```ts
import { test, expect } from './fixtures';
import { createTrip } from './helpers';
import { readFile } from 'node:fs/promises';

test('expense receipt uploads and downloads intact', async ({ page }) => {
	const { tripId } = await createTrip(page);
	await page.goto(`/trips/${tripId}`, { waitUntil: 'networkidle' });

	await page.getByLabel('Description').fill('Dinner');
	await page.getByLabel('Amount').fill('50');
	await page.getByRole('button', { name: 'Add expense' }).click();
	await page.waitForLoadState('networkidle');

	const pdfContent = '%PDF-1.4 test receipt content';
	const buffer = Buffer.from(pdfContent);
	await page.locator('input[type="file"][name="file"]').setInputFiles({
		name: 'receipt.pdf',
		mimeType: 'application/pdf',
		buffer
	});
	await page.getByRole('button', { name: 'Upload' }).click();
	await page.waitForLoadState('networkidle');

	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('link', { name: 'receipt.pdf' }).click();
	const download = await downloadPromise;
	const downloaded = await readFile(await download.path());
	expect(downloaded.toString('utf8')).toBe(pdfContent);
});
```

- [ ] **Step 2: Run the e2e spec**

Run: `rtk npx playwright test tests/e2e/expenses.spec.ts --project=e2e`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/expenses.spec.ts
git commit -m "test: e2e coverage for encrypted receipt upload/download"
```

---

## Task 12: Run full verification

- [ ] **Step 1: Type check and unit tests**

Run: `rtk npm run check`
Expected: 0 errors, 0 warnings.

Run: `rtk npm test`
Expected: all tests pass.

- [ ] **Step 2: E2E tests**

Run: `rtk npx playwright test`
Expected: all tests pass.

- [ ] **Step 3: Final commit if any fixes**

```bash
git commit -a -m "fix: final encrypted attachment verification adjustments" || true
```

---

## Self-review

**Spec coverage:**
- Streaming chunked encryption → Task 3.
- Streaming chunked decryption without plaintext temp files → Task 3.
- Generic service layer → Task 6.
- Schema changes → Task 5.
- Expense receipt refactor → Task 7.
- Download streaming → Task 8.
- E2E coverage → Task 11.

**Placeholder scan:**
- No TBD/TODO/filler steps.
- All code blocks are concrete.

**Type consistency:**
- `attachmentService.createAttachment` returns `AttachmentRecord` (camelCase).
- `attachmentService.readAttachmentStream` returns `{ stream, record }`.
- `tripExpenseAttachments.addAttachment` returns `{ link, attachment }`.
- `readAttachment` returns the stream, record, plus `tripId`, `expenseId`, `linkId`.

**Peer-review fixes applied:**
- Added an authenticated footer chunk to detect truncation at chunk boundaries.
- Replaced the hand-rolled `_read`/`readExactly` decryption implementation with an async generator wrapped in `Readable.from` for correct backpressure and concurrency.
- `encryptChunkedFile` now counts actual plaintext bytes and accepts a `maxBytes` option so the size limit is enforced on the streamed bytes, not just `file.size`.
- `createAttachment` stages ciphertext to a temp key and renames to the final key only after the DB row is inserted, eliminating orphan ciphertext on DB failures.
- Fixed `AttachmentRow.id` to be the expense-attachment link id (matching the URL parameter) and added `attachmentId` for the generic attachment id.
- Updated the Kit migration and schema ordering to match the real MongrelDB Kit API.
- Removed `.returningAll()` calls and fixed `mapRow` JSON context parsing.
- Aligned `getAttachmentsPath` between runtime and restore, with directory-vs-file detection.
- Added explicit tasks to update `tests/helpers.ts`, `expensesRepo.test.ts`, and `tripExpenseAttachments.test.ts`.
- Added `Content-Disposition: attachment` to make the E2E download test reliable.

**Remaining risks to verify during implementation:**
- The exact MongrelDB Kit query syntax for `innerJoin` and the shape of joined rows must be verified against the installed Kit version.
- `decryptChunkedFileStream` must be exercised with large files, slow readers, and client disconnects to ensure cleanup and backpressure are correct.
- SvelteKit/Node multipart parsing may spill uploaded file parts to temporary files before `file.stream()` is consumed. This is outside the attachment subsystem's control; verify behavior if the no-plaintext-temp guarantee must extend end-to-end.

---

## Execution handoff

Plan complete and saved to `docs/specs/2026-07-05-encrypted-attachment-storage-plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Implement the tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach would you like?
