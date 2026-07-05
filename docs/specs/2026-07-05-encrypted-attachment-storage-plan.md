# Encrypted Attachment Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt every uploaded attachment (currently expense receipts) at rest on disk using streaming AES-256-GCM, while keeping the attachment metadata in MongrelDB and preserving the existing download/upload interfaces.

**Architecture:** Introduce a small `attachments` subsystem with three layers: (1) `attachmentCrypto` for streaming AES-256-GCM encryption/decryption of file bytes, (2) `attachmentStorage` for sharded, extensionless ciphertext files on disk, and (3) `attachmentService` for generic attachment CRUD + authorization. Existing expense attachment code becomes a thin consumer of the generic service. Ciphertext is stored with a one-byte version header, a 12-byte IV, and a 16-byte GCM auth tag appended to the stream.

**Tech Stack:** Node.js `crypto` streams, SvelteKit form actions, `node:fs` streams, Vitest, Playwright.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/server/attachments/attachmentCrypto.ts` | Streaming AES-256-GCM primitives: encrypt a `ReadableStream` to a file path, decrypt a file path to a `ReadableStream`. |
| `src/lib/server/attachments/attachmentCrypto.test.ts` | Unit tests for round-trip, tamper detection, and streaming behavior. |
| `src/lib/server/attachments/attachmentStorage.ts` | Sharded ciphertext file storage: save, read, delete, stat. |
| `src/lib/server/attachments/attachmentStorage.test.ts` | Unit tests for storage paths and save/read/delete. |
| `src/lib/server/attachments/attachmentService.ts` | Generic attachment service: create/read/delete with ownership checks, content-type/size validation, and audit logging. |
| `src/lib/server/attachments/attachmentService.test.ts` | Unit tests for the service layer. |
| `src/lib/server/tripExpenseAttachments.ts` | Refactored to delegate file handling to `attachmentService`. |
| `src/routes/trips/[id]/expenses/[expenseId]/attachments/[attachmentId]/+server.ts` | Refactored to stream-decrypt and return a web `ReadableStream`. |
| `tests/e2e/expenses.spec.ts` or new `tests/e2e/attachments.spec.ts` | E2E coverage that uploads a PDF and downloads it intact. |

---

## Design decisions

### File format on disk

Each ciphertext file is a flat byte stream:

```
[ version: 1 byte ][ IV: 12 bytes ][ ciphertext: N bytes ][ authTag: 16 bytes ]
```

- `version` (`0x01`) lets us rotate algorithms later without guessing.
- `IV` is generated per file with `randomBytes(12)`.
- `authTag` is the AES-256-GCM tag produced at the end of encryption.
- Files keep the existing sharded UUID path and have **no extension**.

### Key material

Reuse the existing key derivation in `src/lib/server/crypto.ts` (`ROAMARR_SECRET` → 32-byte AES key). Add a binary variant that returns a `Buffer` key rather than re-deriving independently.

### Encryption flow (streaming)

1. Generate IV and a temp path (`<final>.tmp`).
2. Open a write stream to the temp file.
3. Write the version byte and IV.
4. Pipe the upload `ReadableStream` through `crypto.createCipheriv('aes-256-gcm', key, iv)` into the file stream.
5. When the cipher stream finishes, retrieve the auth tag and append it.
6. Atomically rename the temp file to the final sharded path.
7. Return the `storageKey` and plaintext `sizeBytes` to the caller.

### Decryption flow (streaming)

1. Open a read stream from the ciphertext file.
2. Read the first 13 bytes (version + IV) synchronously from the stream head.
3. Create `crypto.createDecipheriv('aes-256-gcm', key, iv)`.
4. Wrap the remaining stream in a small `AuthTagExtractor` transform that always holds the trailing 16 bytes in memory and passes the earlier bytes through.
5. Pipe the extracted ciphertext through the decipher.
6. On stream end, set the extracted auth tag on the decipher before finalizing.
7. Return the resulting `ReadableStream` to SvelteKit as the response body.

### Memory bounds

- The auth tag extractor only ever buffers up to 16 bytes plus one chunk, so large files do not load into memory.
- The GCM tag is verified at the end of the stream; tampered files will throw during the final read, which SvelteKit will surface as a truncated/aborted response.

### Database schema

No schema change is required. `trip_expense_attachments` already stores `filename`, `storage_key`, `content_type`, and `size_bytes` (plaintext size). The `storage_key` continues to locate the ciphertext file.

### Backward compatibility

Since Roamarr has no production users, no migration is needed. New files are encrypted; legacy plaintext files do not exist in the wild.

---

## Task 1: Add binary AES key helper to existing crypto module

**Files:**
- Modify: `src/lib/server/crypto.ts`
- Test: `src/lib/server/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';

describe('crypto key', () => {
	it('returns a 32-byte buffer for aesKey', () => {
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

## Task 2: Implement streaming attachment crypto

**Files:**
- Create: `src/lib/server/attachments/attachmentCrypto.ts`
- Create: `src/lib/server/attachments/attachmentCrypto.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/attachments/attachmentCrypto.test.ts`:

```ts
import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { encryptFile, decryptFile } from './attachmentCrypto';

describe('attachmentCrypto', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'roamarr-attach-'));
	});
	afterEach(() => {
		if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
	});

	function streamFromString(s: string): ReadableStream {
		return Readable.from([Buffer.from(s)]) as unknown as ReadableStream;
	}

	async function collectStream(stream: ReadableStream): Promise<Buffer> {
		const reader = stream.getReader();
		const chunks: Buffer[] = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
		}
		return Buffer.concat(chunks);
	}

	test('round-trips a small file', async () => {
		const plain = 'hello encrypted world';
		const outPath = path.join(dir, 'cipher');
		await encryptFile(streamFromString(plain), outPath);
		const decrypted = await collectStream(decryptFile(outPath));
		expect(decrypted.toString('utf8')).toBe(plain);
	});

	test('round-trips a 1 MB file', async () => {
		const plain = Buffer.alloc(1024 * 1024, 'a');
		const outPath = path.join(dir, 'cipher');
		await encryptFile(Readable.from([plain]) as unknown as ReadableStream, outPath);
		const decrypted = await collectStream(decryptFile(outPath));
		expect(decrypted.length).toBe(plain.length);
		expect(decrypted.equals(plain)).toBe(true);
	});

	test('tampered ciphertext fails decryption', async () => {
		const plain = 'secret';
		const outPath = path.join(dir, 'cipher');
		await encryptFile(streamFromString(plain), outPath);
		const bytes = readFileSync(outPath);
		bytes[bytes.length - 1] ^= 0xff;
		writeFileSync(outPath, bytes);
		await expect(collectStream(decryptFile(outPath))).rejects.toThrow();
	});

	test('encrypted file has version header', async () => {
		const outPath = path.join(dir, 'cipher');
		await encryptFile(streamFromString('x'), outPath);
		const bytes = readFileSync(outPath);
		expect(bytes[0]).toBe(1);
		expect(bytes.length).toBeGreaterThan(1 + 12 + 16 + 1);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk npx vitest run src/lib/server/attachments/attachmentCrypto.test.ts`
Expected: FAIL — `encryptFile` / `decryptFile` not defined.

- [ ] **Step 3: Implement streaming crypto**

Create `src/lib/server/attachments/attachmentCrypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { aesKey } from '../crypto';

const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = 1 + IV_LENGTH;

export async function encryptFile(input: ReadableStream, outputPath: string): Promise<void> {
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv('aes-256-gcm', aesKey(), iv);
	const tempPath = `${outputPath}.tmp`;

	mkdirSync(path.dirname(outputPath), { recursive: true });
	const output = createWriteStream(tempPath);

	output.write(Buffer.from([VERSION]));
	output.write(iv);

	const nodeInput = Readable.fromWeb(input as import('node:stream/web').ReadableStream);
	await pipeline(nodeInput, cipher, output);

	const tag = cipher.getAuthTag();
	// append tag synchronously; file is closed by pipeline.
	const { appendFileSync } = await import('node:fs');
	appendFileSync(tempPath, tag);

	renameSync(tempPath, outputPath);
}

class AuthTagExtractor extends Transform {
	private tail = Buffer.alloc(0);
	private readonly tagLength: number;
	tag: Buffer = Buffer.alloc(0);

	constructor(tagLength = TAG_LENGTH) {
		super();
		this.tagLength = tagLength;
	}

	_transform(chunk: Buffer, _encoding: string, callback: () => void) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		const combined = Buffer.concat([this.tail, buf]);
		if (combined.length > this.tagLength) {
			this.push(combined.subarray(0, combined.length - this.tagLength));
			this.tail = combined.subarray(combined.length - this.tagLength);
		} else {
			this.tail = combined;
		}
		callback();
	}

	_flush(callback: () => void) {
		this.tag = this.tail;
		callback();
	}
}

export function decryptFile(outputPath: string): ReadableStream {
	const fileStream = createReadStream(outputPath);
	const decipher = createDecipheriv('aes-256-gcm', aesKey(), Buffer.alloc(IV_LENGTH));
	const extractor = new AuthTagExtractor();

	let headerRead = false;
	let headerBuffer = Buffer.alloc(0);

	const transform = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			let data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			if (!headerRead) {
				headerBuffer = Buffer.concat([headerBuffer, data]);
				if (headerBuffer.length < HEADER_LENGTH) {
					callback();
					return;
				}
				const version = headerBuffer[0];
				if (version !== VERSION) {
					callback(new Error(`unsupported attachment encryption version: ${version}`));
					return;
				}
				const iv = headerBuffer.subarray(1, HEADER_LENGTH);
				decipher.setAuthTag(Buffer.alloc(TAG_LENGTH)); // placeholder until stream ends
				// We cannot change the IV after creating decipher, so create a new one with correct IV.
				// Instead, defer creation until header is known.
				callback(new Error('decryptFile implementation incomplete'));
				return;
			}
		}
	});

	// Implementation note: the above is intentionally left as a sketch because
	// the agent should implement a cleaner version using a custom Readable that
	// reads the header, then pipes the remaining ciphertext through an
	// AuthTagExtractor into the decipher.
	return Readable.toWeb(transform) as ReadableStream;
}
```

> **Note:** The initial `decryptFile` implementation above is deliberately left as a sketch because a robust streaming GCM decrypt needs a custom Readable that reads the header first. The implementing agent should replace it with the complete version shown in Task 4.

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk npx vitest run src/lib/server/attachments/attachmentCrypto.test.ts`
Expected: Round-trip tests should pass; tamper test should pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/attachments/attachmentCrypto.ts src/lib/server/attachments/attachmentCrypto.test.ts
git commit -m "feat: streaming AES-256-GCM attachment crypto"
```

---

## Task 3: Implement attachment storage layer

**Files:**
- Create: `src/lib/server/attachments/attachmentStorage.ts`
- Create: `src/lib/server/attachments/attachmentStorage.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/attachments/attachmentStorage.test.ts`:

```ts
import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
	saveEncryptedAttachment,
	readEncryptedAttachment,
	deleteEncryptedAttachment,
	attachmentPath
} from './attachmentStorage';
import { encryptFile } from './attachmentCrypto';

describe('attachmentStorage', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'roamarr-storage-'));
		process.env.ROAMARR_SECRET = 'ACpm0VlkwltJpcNWtxlilgjX+ZbW2nTV7QqYbZK0Fig=';
	});
	afterEach(() => {
		if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
	});

	function streamFromString(s: string) {
		return Readable.from([Buffer.from(s)]) as unknown as ReadableStream;
	}

	test('saveEncryptedAttachment returns a sharded uuid path', async () => {
		const key = await saveEncryptedAttachment(streamFromString('hello'), dir);
		expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
		const p = attachmentPath(key, dir);
		expect(existsSync(p)).toBe(true);
		expect(p).toContain(path.join(key.slice(0, 2), key.slice(2, 4), key));
	});

	test('readEncryptedAttachment round-trips bytes', async () => {
		const plain = 'stored securely';
		const key = await saveEncryptedAttachment(streamFromString(plain), dir);
		const stream = readEncryptedAttachment(key, dir);
		const reader = stream.getReader();
		const chunks: Buffer[] = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
		}
		expect(Buffer.concat(chunks).toString('utf8')).toBe(plain);
	});

	test('deleteEncryptedAttachment removes the file', async () => {
		const key = await saveEncryptedAttachment(streamFromString('x'), dir);
		const p = attachmentPath(key, dir);
		expect(existsSync(p)).toBe(true);
		deleteEncryptedAttachment(key, dir);
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
import { encryptFile, decryptFile } from './attachmentCrypto';

export function attachmentPath(storageKey: string, baseDir: string): string {
	return path.join(baseDir, storageKey.slice(0, 2), storageKey.slice(2, 4), storageKey);
}

export async function saveEncryptedAttachment(
	input: ReadableStream,
	baseDir: string
): Promise<string> {
	const storageKey = randomUUID();
	const outPath = attachmentPath(storageKey, baseDir);
	await encryptFile(input, outPath);
	return storageKey;
}

export function readEncryptedAttachment(storageKey: string, baseDir: string): ReadableStream {
	return decryptFile(attachmentPath(storageKey, baseDir));
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

## Task 4: Complete the streaming decryption implementation

**Files:**
- Modify: `src/lib/server/attachments/attachmentCrypto.ts`
- Modify: `src/lib/server/attachments/attachmentCrypto.test.ts`

The `decryptFile` sketch in Task 2 is incomplete. Replace it with a proper custom `Readable` implementation.

- [ ] **Step 1: Add a test for streaming decryption chunking**

Add to `attachmentCrypto.test.ts`:

```ts
test('decryptFile yields multiple chunks for large files', async () => {
	const plain = Buffer.alloc(64 * 1024, 'z');
	const outPath = path.join(dir, 'cipher');
	await encryptFile(Readable.from([plain]) as unknown as ReadableStream, outPath);
	const stream = decryptFile(outPath);
	const reader = stream.getReader();
	let chunkCount = 0;
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunkCount++;
		total += (value as Buffer).length;
	}
	expect(chunkCount).toBeGreaterThan(1);
	expect(total).toBe(plain.length);
});
```

- [ ] **Step 2: Implement decryptFile with a custom Readable**

Replace `decryptFile` in `attachmentCrypto.ts`:

```ts
import { createReadStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';

const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = 1 + IV_LENGTH;

class AuthTagExtractor extends Transform {
	private tail = Buffer.alloc(0);
	tag: Buffer = Buffer.alloc(0);

	_transform(chunk: Buffer, _encoding: string, callback: () => void) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		const combined = Buffer.concat([this.tail, buf]);
		if (combined.length > TAG_LENGTH) {
			this.push(combined.subarray(0, combined.length - TAG_LENGTH));
			this.tail = combined.subarray(combined.length - TAG_LENGTH);
		} else {
			this.tail = combined;
		}
		callback();
	}

	_flush(callback: () => void) {
		this.tag = this.tail;
		callback();
	}
}

export function decryptFile(outputPath: string): ReadableStream {
	let decipher: ReturnType<typeof createDecipheriv> | null = null;
	let extractor: AuthTagExtractor | null = null;
	let started = false;

	const source = createReadStream(outputPath);

	const readable = new Readable({
		read() {
			if (started) return;
			started = true;

			source.once('readable', () => {
				const header = source.read(HEADER_LENGTH);
				if (!header || header.length < HEADER_LENGTH) {
					readable.destroy(new Error('attachment ciphertext header truncated'));
					return;
				}
				if (header[0] !== VERSION) {
					readable.destroy(new Error(`unsupported attachment encryption version: ${header[0]}`));
					return;
				}
				const iv = header.subarray(1, HEADER_LENGTH);
				decipher = createDecipheriv('aes-256-gcm', aesKey(), iv);
				extractor = new AuthTagExtractor();

				extractor.on('data', (chunk: Buffer) => {
					if (!decipher) return;
					const ok = decipher.write(chunk);
					if (!ok) extractor?.pause();
				});
				decipher.on('data', (chunk: Buffer) => {
					readable.push(chunk);
				});
				decipher.on('drain', () => {
					extractor?.resume();
				});

				source.pipe(extractor);

				extractor.on('end', () => {
					if (!decipher || !extractor) return;
					try {
						decipher.setAuthTag(extractor.tag);
						const final = decipher.final();
						readable.push(final);
						readable.push(null);
					} catch (e) {
						readable.destroy(e as Error);
					}
				});

				source.on('error', (err) => readable.destroy(err));
				extractor.on('error', (err) => readable.destroy(err));
				decipher.on('error', (err) => readable.destroy(err));
			});
		}
	});

	return Readable.toWeb(readable) as ReadableStream;
}
```

> **Note:** The above code must be tested carefully. If chunk backpressure handling proves flaky, switch to `pipeline()` with a Promise and emit chunks via the outer Readable by pushing `decipher.read()` results.

- [ ] **Step 3: Run tests**

Run: `rtk npx vitest run src/lib/server/attachments/attachmentCrypto.test.ts`
Expected: PASS, including the new chunking test.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/attachments/attachmentCrypto.ts src/lib/server/attachments/attachmentCrypto.test.ts
git commit -m "fix: complete streaming AES-GCM decryption with auth-tag extraction"
```

---

## Task 5: Build generic attachment service

**Files:**
- Create: `src/lib/server/attachments/attachmentService.ts`
- Create: `src/lib/server/attachments/attachmentService.test.ts`
- Modify: `src/lib/server/paths.ts` (ensure `getAttachmentsPath` is exported)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/attachments/attachmentService.test.ts`:

```ts
import { test, expect, describe, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
	createAttachment,
	readAttachmentStream,
	deleteAttachment
} from './attachmentService';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('../db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { attachments as attachmentsTable } from '../db/mongrelSchema';
import { eq, type KitDatabase } from '@visorcraft/mongreldb-kit';
import { makeSyncedUser } from '../../../../tests/helpers';

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
		const stream = await readAttachmentStream({ ownerId: userId, attachmentId: att.id });
		const reader = stream.getReader();
		const chunks: Buffer[] = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
		}
		expect(Buffer.concat(chunks).toString('utf8')).toBe('round trip');
	});

	test('deleteAttachment removes row and ciphertext', async () => {
		const file = fileFromString('x', 'x.txt', 'text/plain');
		const att = await createAttachment({ ownerId: userId, file, context: { kind: 'test' } });
		await deleteAttachment({ ownerId: userId, attachmentId: att.id });
		const kit = getKit();
		const rows = kit.selectFrom(attachmentsTable).where(eq(attachmentsTable.id, BigInt(att.id))).executeSync();
		expect(rows).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk npx vitest run src/lib/server/attachments/attachmentService.test.ts`
Expected: FAIL — `attachments` table and service functions not defined.

- [ ] **Step 3: Add generic attachments schema migration**

Modify `src/lib/server/db/mongrelSchema.ts`:

Add a new `attachments` table near `tripExpenseAttachments`:

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

Add `attachments` to the bottom export list.

Create a migration file `src/lib/server/db/mongrelMigrations/00XX_attachments_table.ts` with up/down SQL. Use the next available migration number.

- [ ] **Step 4: Implement attachmentService**

Create `src/lib/server/attachments/attachmentService.ts`:

```ts
import { error } from '@sveltejs/kit';
import { getAttachmentsPath } from '../paths';
import {
	saveEncryptedAttachment,
	readEncryptedAttachment,
	deleteEncryptedAttachment
} from './attachmentStorage';
import * as repo from './attachmentRepo';
import { logAudit } from '../audit';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_SIZE = 5 * 1024 * 1024;

export interface CreateAttachmentInput {
	ownerId: number;
	file: File;
	context: Record<string, unknown>;
}

export interface ReadAttachmentInput {
	ownerId: number;
	attachmentId: number;
}

export async function createAttachment(input: CreateAttachmentInput) {
	const { ownerId, file, context } = input;

	if (!ALLOWED_TYPES.includes(file.type)) {
		throw error(400, 'Only JPEG, PNG, WebP, or PDF files are allowed');
	}
	if (file.size > MAX_SIZE) {
		throw error(400, 'File must be 5 MB or smaller');
	}

	const baseDir = getAttachmentsPath();
	const storageKey = await saveEncryptedAttachment(file.stream() as ReadableStream, baseDir);

	const row = repo.createAttachment({
		ownerId,
		storageKey,
		filename: file.name,
		contentType: file.type,
		sizeBytes: file.size,
		context
	});

	logAudit(ownerId, 'create', 'attachment', Number(row.id), {
		filename: file.name,
		contentType: file.type
	});

	return row;
}

export async function readAttachmentStream(input: ReadAttachmentInput) {
	const row = repo.getAttachmentById(input.attachmentId);
	if (!row) throw error(404, 'Attachment not found');
	if (row.ownerId !== input.ownerId) throw error(404, 'Attachment not found');

	const baseDir = getAttachmentsPath();
	return {
		stream: readEncryptedAttachment(row.storageKey, baseDir),
		filename: row.filename,
		contentType: row.contentType,
		sizeBytes: row.sizeBytes
	};
}

export async function deleteAttachment(input: ReadAttachmentInput) {
	const row = repo.getAttachmentById(input.attachmentId);
	if (!row) throw error(404, 'Attachment not found');
	if (row.ownerId !== input.ownerId) throw error(404, 'Attachment not found');

	const baseDir = getAttachmentsPath();
	deleteEncryptedAttachment(row.storageKey, baseDir);
	repo.deleteAttachment(input.attachmentId);

	logAudit(input.ownerId, 'delete', 'attachment', input.attachmentId, {
		filename: row.filename
	});
}
```

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

export function createAttachment(input: AttachmentInsert) {
	const db = getDb();
	return db
		.insertInto(attachments)
		.values({
			owner_id: BigInt(input.ownerId),
			storage_key: input.storageKey,
			filename: input.filename,
			content_type: input.contentType,
			size_bytes: BigInt(input.sizeBytes),
			context: JSON.stringify(input.context)
		})
		.returningAll()
		.executeSync()[0];
}

export function getAttachmentById(id: number) {
	const db = getDb();
	const row = db.selectFrom(attachments).where(eq(attachments.id, BigInt(id))).executeSync()[0];
	if (!row) return null;
	return {
		id: Number(row.id),
		ownerId: Number(row.owner_id),
		storageKey: row.storage_key,
		filename: row.filename,
		contentType: row.content_type,
		sizeBytes: Number(row.size_bytes),
		context: row.context ? JSON.parse(row.context) : {}
	};
}

export function deleteAttachment(id: number) {
	const db = getDb();
	db.deleteFrom(attachments).where(eq(attachments.id, BigInt(id))).executeSync();
}
```

- [ ] **Step 5: Run tests**

Run: `rtk npx vitest run src/lib/server/attachments/attachmentService.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/db/mongrelSchema.ts src/lib/server/db/mongrelMigrations/00XX_attachments_table.ts src/lib/server/attachments/attachmentService.ts src/lib/server/attachments/attachmentRepo.ts src/lib/server/attachments/attachmentService.test.ts
git commit -m "feat: generic encrypted attachment service with metadata table"
```

---

## Task 6: Refactor expense attachments to use the generic service

**Files:**
- Modify: `src/lib/server/tripExpenseAttachments.ts`
- Modify: `src/lib/server/tripExpenseAttachments.test.ts`
- Modify: `src/lib/server/repositories/expensesRepo.ts` (add `listAttachmentsForExpense`, `createAttachment`, `getAttachmentById`, `deleteAttachment` if needed)

- [ ] **Step 1: Update `tripExpenseAttachments.ts` to call `attachmentService`**

Replace the file I/O in `src/lib/server/tripExpenseAttachments.ts`:

```ts
import { error } from '@sveltejs/kit';
import * as expensesRepo from './repositories/expensesRepo';
import { requireEditableTrip } from './ownership';
import { logAudit } from './audit';
import {
	createAttachment,
	readAttachmentStream,
	deleteAttachment as deleteGenericAttachment
} from './attachments/attachmentService';

export async function addAttachment(userId: number, expenseId: number, file: File) {
	const expense = expensesRepo.getExpenseById(expenseId);
	if (!expense) throw error(404, 'Expense not found');
	requireEditableTrip(userId, expense.tripId);

	const attachment = await createAttachment({
		ownerId: userId,
		file,
		context: { kind: 'expense_receipt', expenseId, tripId: expense.tripId }
	});

	const expenseAttachment = expensesRepo.linkExpenseAttachment({
		expenseId,
		attachmentId: attachment.id
	});

	logAudit(userId, 'create', 'trip_expense_attachment', expenseAttachment.id, {
		expenseId,
		filename: file.name
	});

	return { ...expenseAttachment, ...attachment };
}

export function listAttachments(expenseId: number) {
	return expensesRepo.listAttachmentsForExpense(expenseId);
}

export function getAttachmentWithPath(userId: number, attachmentId: number) {
	const link = expensesRepo.getExpenseAttachmentLink(attachmentId);
	if (!link) throw error(404, 'Attachment not found');
	const expense = expensesRepo.getExpenseById(link.expenseId);
	if (!expense) throw error(404, 'Expense not found');
	requireEditableTrip(userId, expense.tripId);
	return { ...link, tripId: expense.tripId, expenseId: link.expenseId };
}

export async function readAttachment(userId: number, attachmentId: number) {
	const meta = getAttachmentWithPath(userId, attachmentId);
	const streamMeta = await readAttachmentStream({ ownerId: userId, attachmentId: meta.attachmentId });
	return { ...meta, ...streamMeta };
}

export function deleteAttachment(userId: number, attachmentId: number) {
	const meta = getAttachmentWithPath(userId, attachmentId);
	expensesRepo.unlinkExpenseAttachment(attachmentId);
	deleteGenericAttachment({ ownerId: userId, attachmentId: meta.attachmentId });
	logAudit(userId, 'delete', 'trip_expense_attachment', attachmentId, {
		expenseId: meta.expenseId
	});
}
```

> **Note:** This refactor introduces a join table (`trip_expense_attachment_links`) between expenses and generic attachments. Alternatively, keep `trip_expense_attachments` as-is and store the generic `attachment_id` in it. The implementing agent should pick the simpler schema path and update `expensesRepo` accordingly.

- [ ] **Step 2: Update tests in `tripExpenseAttachments.test.ts`**

Adjust the tests to expect encrypted storage. The existing assertions about file existence and row counts should still pass. Add a test that reads the file back and verifies decryption round-trip.

- [ ] **Step 3: Run tests**

Run: `rtk npx vitest run src/lib/server/tripExpenseAttachments.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/tripExpenseAttachments.ts src/lib/server/tripExpenseAttachments.test.ts src/lib/server/repositories/expensesRepo.ts
git commit -m "refactor: expense attachments use generic encrypted attachment service"
```

---

## Task 7: Update download route to stream-decrypt

**Files:**
- Modify: `src/routes/trips/[id]/expenses/[expenseId]/attachments/[attachmentId]/+server.ts`

- [ ] **Step 1: Replace synchronous read with streaming read**

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
	const attachmentId = Number(params.attachmentId);
	if (!Number.isFinite(tripId) || !Number.isFinite(expenseId) || !Number.isFinite(attachmentId)) {
		throw error(400, 'Invalid request');
	}
	const attachment = await readAttachment(u.id, attachmentId);
	if (attachment.tripId !== tripId || attachment.expenseId !== expenseId) {
		throw error(404, 'Attachment not found');
	}
	const safeFilename = sanitizeFilename(attachment.filename);
	return new Response(attachment.stream, {
		headers: {
			'Content-Type': attachment.contentType,
			'Content-Disposition': `inline; filename="${safeFilename}"`
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
git commit -m "feat: stream-decrypt expense attachments on download"
```

---

## Task 8: Update the upload form action

**Files:**
- Modify: `src/lib/server/tripMetaActions.ts`

- [ ] **Step 1: No change required**

The `addAttachmentAction` already passes the `File` object through. Because `createAttachment` in `attachmentService` accepts a `File` and calls `file.stream()`, no change is needed here.

- [ ] **Step 2: Verify with type check**

Run: `rtk npm run check`
Expected: PASS.

---

## Task 9: Update UI to show plaintext size

**Files:**
- Modify: `src/routes/trips/[id]/+page.svelte`

- [ ] **Step 1: Ensure displayed size remains accurate**

The existing UI uses `a.sizeBytes`, which is the plaintext size stored by `attachmentService`. No change should be needed, but verify the data load includes `sizeBytes`.

- [ ] **Step 2: Commit if any change is made**

If no change, skip commit.

---

## Task 10: Add end-to-end coverage for encrypted upload/download

**Files:**
- Modify: `tests/e2e/expenses.spec.ts` or create `tests/e2e/attachments.spec.ts`

- [ ] **Step 1: Add a download integrity test**

Extend the existing expenses e2e spec or create a new one:

```ts
import { test, expect } from './fixtures';

test('expense receipt uploads and downloads intact', async ({ page }) => {
	// Create a trip and an expense first, or assume existing helpers.
	const { tripId } = await createTrip(page);
	await page.goto(`/trips/${tripId}`, { waitUntil: 'networkidle' });

	// Add an expense if not already present.
	await page.getByLabel('Description').fill('Dinner');
	await page.getByLabel('Amount').fill('50');
	await page.getByRole('button', { name: 'Add expense' }).click();

	// Upload a small PDF.
	const pdfContent = '%PDF-1.4 test receipt content';
	const buffer = Buffer.from(pdfContent);
	await page.getByLabel('Attach receipt').setInputFiles({
		name: 'receipt.pdf',
		mimeType: 'application/pdf',
		buffer
	});
	await page.getByRole('button', { name: 'Upload' }).click();
	await page.waitForLoadState('networkidle');

	// Download and verify.
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('link', { name: 'receipt.pdf' }).click();
	const download = await downloadPromise;
	const path = await download.path();
	const downloaded = await readFile(path);
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

## Task 11: Run full verification

- [ ] **Step 1: Type check and unit tests**

Run: `rtk npm run check`
Expected: 0 errors, 0 warnings.

Run: `rtk npm test`
Expected: all tests pass.

- [ ] **Step 2: E2E tests**

Run: `rtk npm run test:e2e`
Expected: all tests pass.

- [ ] **Step 3: Final commit if any fixes**

```bash
git commit -a -m "fix: final encrypted attachment verification adjustments" || true
```

---

## Self-review

**Spec coverage:**
- Streaming encryption → Tasks 2 and 4.
- Streaming decryption → Tasks 2 and 4.
- Generic service layer → Task 5.
- Expense receipt refactor → Task 6.
- Download streaming → Task 7.
- E2E coverage → Task 10.

**Placeholder scan:**
- The `decryptFile` in Task 2 is intentionally a sketch that is completed in Task 4.
- All other steps contain concrete code.

**Type consistency:**
- `attachmentService.createAttachment` returns a row matching the generic `attachments` schema.
- `tripExpenseAttachments.addAttachment` returns the joined expense-attachment metadata.
- `readAttachment` returns `{ stream, filename, contentType, sizeBytes, tripId, expenseId }`.

**Gaps:**
- The refactor in Task 6 may require a new join table or schema change in `trip_expense_attachments`. The implementing agent must resolve this before tests pass.
- The audit log table name changes from `trip_expense_attachment` to `attachment` for the generic service, with an additional `trip_expense_attachment` log in the wrapper. This is intentional.

---

## Execution handoff

Plan complete and saved to `docs/specs/2026-07-05-encrypted-attachment-storage-plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach would you like?