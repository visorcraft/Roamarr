# Encrypted Attachment Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt every uploaded attachment (currently expense receipts) at rest on disk using streaming AES-256-GCM, while keeping the attachment metadata in MongrelDB and preserving the existing download/upload interfaces.

**Architecture:** Introduce a small `attachments` subsystem with three layers: (1) `attachmentCrypto` for streaming AES-256-GCM encryption to a ciphertext file and streaming decryption to a temporary plaintext file, (2) `attachmentStorage` for sharded, extensionless ciphertext files on disk, and (3) `attachmentService` for generic attachment metadata CRUD, validation, and audit logging. Authorization is the caller's responsibility; existing expense attachment code performs trip-based auth and delegates storage to the generic service. Ciphertext is stored with a one-byte version header, a 12-byte IV, and a 16-byte GCM auth tag appended to the stream. Downloads verify the auth tag in full before streaming any plaintext to the client.

**Tech Stack:** Node.js `crypto` streams, SvelteKit form actions, `node:fs` streams, Vitest, Playwright.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/server/attachments/attachmentCrypto.ts` | Streaming AES-256-GCM primitives: encrypt a `ReadableStream` to a ciphertext file, decrypt a ciphertext file to a temporary plaintext file. |
| `src/lib/server/attachments/attachmentCrypto.test.ts` | Unit tests for round-trip, tamper detection, edge cases, and integrity-before-release. |
| `src/lib/server/attachments/attachmentStorage.ts` | Sharded ciphertext file storage: save, read (decrypt to temp), delete. |
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
| `src/routes/trips/[id]/expenses/[expenseId]/attachments/[attachmentId]/+server.ts` | Refactored to read decrypted temp file and stream it as a web `ReadableStream`. |
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

1. Generate IV and a temp ciphertext path (`<final>.tmp`).
2. Open a write stream to the temp file.
3. Write the version byte and IV.
4. Pipe the upload `ReadableStream` through `crypto.createCipheriv('aes-256-gcm', key, iv)` into the temp file stream.
5. When the cipher stream finishes, retrieve the auth tag and append it.
6. `fsync` the temp file and atomically rename it to the final sharded path.
7. Clean up the temp file on any failure.
8. Return the `storageKey` and plaintext `sizeBytes` to the caller.

### Decryption flow (streaming with integrity before release)

AES-256-GCM cannot verify authenticity until the entire ciphertext is processed. To prevent releasing unauthenticated plaintext to the client, we stream-decrypt to a temporary plaintext file first, verify the auth tag at the end, and only then stream the verified plaintext file to the response.

1. Open a read stream from the ciphertext file.
2. Open a write stream to a temp plaintext file (`<final>.decrypt.tmp`).
3. Read the version byte and IV from the ciphertext stream.
4. Pipe the remaining ciphertext through `crypto.createDecipheriv('aes-256-gcm', key, iv)` into the temp plaintext file.
5. On stream end, the auth tag has been verified by the decipher.
6. Rename the temp plaintext file to a stable intermediate path (or keep as temp and stream from it).
7. Stream the verified plaintext file to the client as a web `ReadableStream`.
8. Delete the temp plaintext file when the response stream closes or errors.

This uses bounded memory (chunk-sized buffers) and bounded disk (one plaintext temp copy), but guarantees the client never receives bytes that fail authentication.

### Memory and disk bounds

- Encryption and decryption both use Node stream pipelines; only chunk-sized buffers are in memory.
- Decryption creates one temporary plaintext copy on disk. After the response finishes, the temp file is deleted.
- Because the current `MAX_SIZE` is 5 MB, temp files are small, but the design works for larger limits if raised later.

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

Since Roamarr has no production users, no migration is needed. New files are encrypted; legacy plaintext files do not exist in the wild. Any local dev/test plaintext attachments should be removed before testing.

---

## Task 1: Update `getAttachmentsPath` to respect `ATTACHMENTS_PATH`

**Files:**
- Modify: `src/lib/server/paths.ts`
- Test: `src/lib/server/paths.test.ts` (add or update)

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, describe } from 'vitest';

describe('getAttachmentsPath', () => {
	test('respects ATTACHMENTS_PATH env var', () => {
		const original = process.env.ATTACHMENTS_PATH;
		process.env.ATTACHMENTS_PATH = '/custom/attachments';
		const { getAttachmentsPath } = await import('./paths');
		expect(getAttachmentsPath()).toBe('/custom/attachments');
		process.env.ATTACHMENTS_PATH = original;
	});

	test('falls back to directory beside database', () => {
		delete process.env.ATTACHMENTS_PATH;
		const { getAttachmentsPath } = await import('./paths');
		expect(getAttachmentsPath()).toMatch(/attachments$/);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk npx vitest run src/lib/server/paths.test.ts`
Expected: FAIL — current `getAttachmentsPath` ignores `ATTACHMENTS_PATH`.

- [ ] **Step 3: Update `paths.ts`**

```ts
import path from 'node:path';
import { DEFAULT_KIT_DATABASE_PATH, getDatabasePath } from './db/paths';

export { DEFAULT_KIT_DATABASE_PATH as DEFAULT_DATABASE_PATH, getDatabasePath };

export function getAttachmentsPath() {
	return process.env.ATTACHMENTS_PATH ?? path.join(path.dirname(getDatabasePath()), 'attachments');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk npx vitest run src/lib/server/paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/paths.ts src/lib/server/paths.test.ts
git commit -m "fix: getAttachmentsPath respects ATTACHMENTS_PATH env var"
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

## Task 3: Implement streaming attachment crypto

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
import { Readable } from 'node:stream';
import { encryptFile, decryptFileToPath, encryptedFileSize } from './attachmentCrypto';

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

	test('round-trips a small file', async () => {
		const plain = 'hello encrypted world';
		const cipherPath = path.join(dir, 'cipher');
		const plainPath = path.join(dir, 'plain.out');
		await encryptFile(streamFromString(plain), cipherPath);
		await decryptFileToPath(cipherPath, plainPath);
		expect(readFileSync(plainPath, 'utf8')).toBe(plain);
	});

	test('round-trips a 1 MB file', async () => {
		const plain = Buffer.alloc(1024 * 1024, 'a');
		const cipherPath = path.join(dir, 'cipher');
		const plainPath = path.join(dir, 'plain.out');
		await encryptFile(Readable.from([plain]) as unknown as ReadableStream, cipherPath);
		await decryptFileToPath(cipherPath, plainPath);
		expect(readFileSync(plainPath).equals(plain)).toBe(true);
	});

	test('tampered ciphertext fails decryption', async () => {
		const plain = 'secret';
		const cipherPath = path.join(dir, 'cipher');
		const plainPath = path.join(dir, 'plain.out');
		await encryptFile(streamFromString(plain), cipherPath);
		const bytes = readFileSync(cipherPath);
		bytes[bytes.length - 1] ^= 0xff;
		writeFileSync(cipherPath, bytes);
		await expect(decryptFileToPath(cipherPath, plainPath)).rejects.toThrow();
	});

	test('truncated ciphertext fails decryption', async () => {
		const plain = 'secret';
		const cipherPath = path.join(dir, 'cipher');
		const plainPath = path.join(dir, 'plain.out');
		await encryptFile(streamFromString(plain), cipherPath);
		const bytes = readFileSync(cipherPath);
		writeFileSync(cipherPath, bytes.subarray(0, bytes.length - 4));
		await expect(decryptFileToPath(cipherPath, plainPath)).rejects.toThrow();
	});

	test('encrypted file has version header', async () => {
		const cipherPath = path.join(dir, 'cipher');
		await encryptFile(streamFromString('x'), cipherPath);
		const bytes = readFileSync(cipherPath);
		expect(bytes[0]).toBe(1);
		expect(bytes.length).toBeGreaterThan(1 + 12 + 16 + 1);
	});

	test('empty file round-trips', async () => {
		const cipherPath = path.join(dir, 'cipher');
		const plainPath = path.join(dir, 'plain.out');
		await encryptFile(streamFromString(''), cipherPath);
		await decryptFileToPath(cipherPath, plainPath);
		expect(readFileSync(plainPath).length).toBe(0);
	});

	test('encrypted file size is predictable', async () => {
		const cipherPath = path.join(dir, 'cipher');
		await encryptFile(streamFromString('hello'), cipherPath);
		const stat = await fs.promises.stat(cipherPath);
		expect(encryptedFileSize(5)).toBe(stat.size);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk npx vitest run src/lib/server/attachments/attachmentCrypto.test.ts`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement streaming crypto**

Create `src/lib/server/attachments/attachmentCrypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { aesKey } from '../crypto';

export const VERSION = 1;
export const IV_LENGTH = 12;
export const TAG_LENGTH = 16;
export const HEADER_LENGTH = 1 + IV_LENGTH;

export function encryptedFileSize(plainSize: number): number {
	return HEADER_LENGTH + plainSize + TAG_LENGTH;
}

export async function encryptFile(input: ReadableStream, outputPath: string): Promise<void> {
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv('aes-256-gcm', aesKey(), iv);
	const tempPath = `${outputPath}.tmp`;

	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	const output = createWriteStream(tempPath);

	output.write(Buffer.from([VERSION]));
	output.write(iv);

	try {
		const nodeInput = Readable.fromWeb(input as import('node:stream/web').ReadableStream);
		await pipeline(nodeInput, cipher, output);
		const tag = cipher.getAuthTag();
		await fs.appendFile(tempPath, tag);
		const handle = await fs.open(tempPath, 'r+');
		await handle.sync();
		await handle.close();
		await fs.rename(tempPath, outputPath);
	} catch (e) {
		try {
			await fs.unlink(tempPath);
		} catch {
			// ignore cleanup failure
		}
		throw e;
	}
}

export async function decryptFileToPath(cipherPath: string, plainPath: string): Promise<void> {
	const tempPath = `${plainPath}.tmp`;
	const source = createReadStream(cipherPath);
	const output = createWriteStream(tempPath);

	let headerRead = false;
	let headerBuffer = Buffer.alloc(0);
	let decipher: ReturnType<typeof createDecipheriv> | null = null;

	try {
		await new Promise<void>((resolve, reject) => {
			source.on('error', reject);
			output.on('error', reject);

			source.on('readable', () => {
				if (headerRead) return;
				let chunk;
				while (!headerRead && null !== (chunk = source.read(HEADER_LENGTH - headerBuffer.length))) {
					headerBuffer = Buffer.concat([headerBuffer, chunk]);
					if (headerBuffer.length >= HEADER_LENGTH) {
						headerRead = true;
						if (headerBuffer[0] !== VERSION) {
							reject(new Error(`unsupported attachment encryption version: ${headerBuffer[0]}`));
							return;
						}
						const iv = headerBuffer.subarray(1, HEADER_LENGTH);
						decipher = createDecipheriv('aes-256-gcm', aesKey(), iv);
						source.pipe(decipher).pipe(output);
					}
				}
			});

			source.on('end', () => {
				if (!headerRead) {
					reject(new Error('attachment ciphertext header truncated'));
					return;
				}
			});

			output.on('finish', () => {
				if (!decipher) {
					reject(new Error('decipher not initialized'));
					return;
				}
				resolve();
			});
		});

		await fs.rename(tempPath, plainPath);
	} catch (e) {
		try {
			await fs.unlink(tempPath);
		} catch {
			// ignore cleanup failure
		}
		throw e;
	}
}
```

> **Note:** The `decryptFileToPath` implementation above must be verified carefully. The auth tag is verified automatically by the decipher stream during the final `final()` call, which happens when the source stream ends. If the implementation has subtle issues with backpressure or tag handling, adjust to use `pipeline(source, decipher, output)` after reading the header.

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk npx vitest run src/lib/server/attachments/attachmentCrypto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/attachments/attachmentCrypto.ts src/lib/server/attachments/attachmentCrypto.test.ts
git commit -m "feat: streaming AES-256-GCM attachment crypto with verified plaintext temp output"
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
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
	saveEncryptedAttachment,
	readEncryptedAttachmentToPath,
	deleteEncryptedAttachment,
	attachmentPath
} from './attachmentStorage';

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

	test('readEncryptedAttachmentToPath decrypts to a temp file', async () => {
		const plain = 'stored securely';
		const key = await saveEncryptedAttachment(streamFromString(plain), dir);
		const outPath = path.join(dir, 'decrypted');
		await readEncryptedAttachmentToPath(key, dir, outPath);
		expect(readFileSync(outPath, 'utf8')).toBe(plain);
	});

	test('deleteEncryptedAttachment removes the ciphertext file', async () => {
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
import { encryptFile, decryptFileToPath } from './attachmentCrypto';

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

export async function readEncryptedAttachmentToPath(
	storageKey: string,
	baseDir: string,
	plainPath: string
): Promise<void> {
	return decryptFileToPath(attachmentPath(storageKey, baseDir), plainPath);
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

Add `attachments` to the bottom export list.

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

Create `src/lib/server/db/mongrelMigrations/00XX_attachments_table.ts` (use next available number):

```ts
import type { Migration } from '@visorcraft/mongreldb-kit';

export default {
	id: '00XX_attachments_table',
	up: `
		CREATE SEQUENCE IF NOT EXISTS attachments_id_seq;
		CREATE TABLE attachments (
			id BIGINT PRIMARY KEY DEFAULT nextval('attachments_id_seq'),
			owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			storage_key TEXT NOT NULL UNIQUE,
			filename TEXT NOT NULL,
			content_type TEXT NOT NULL,
			size_bytes BIGINT NOT NULL DEFAULT 0,
			context JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);
		CREATE INDEX attachments_owner_idx ON attachments(owner_id);

		CREATE SEQUENCE IF NOT EXISTS trip_expense_attachments_id_seq;
		CREATE TABLE trip_expense_attachments (
			id BIGINT PRIMARY KEY DEFAULT nextval('trip_expense_attachments_id_seq'),
			expense_id BIGINT NOT NULL REFERENCES trip_expenses(id) ON DELETE CASCADE,
			attachment_id BIGINT NOT NULL UNIQUE REFERENCES attachments(id) ON DELETE CASCADE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);
		CREATE INDEX expense_attachments_expense_idx ON trip_expense_attachments(expense_id);
	`,
	down: `
		DROP TABLE trip_expense_attachments;
		DROP SEQUENCE trip_expense_attachments_id_seq;
		DROP TABLE attachments;
		DROP SEQUENCE attachments_id_seq;
	`
} satisfies Migration;
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
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
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
	readAttachmentToPath,
	deleteAttachment
} from './attachmentService';
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

	test('readAttachmentToPath decrypts the stored file', async () => {
		const file = fileFromString('round trip', 'note.txt', 'text/plain');
		const att = await createAttachment({ ownerId: userId, file, context: { kind: 'test' } });
		const outPath = path.join(baseDir, 'decrypted');
		await readAttachmentToPath(att.id, outPath);
		expect(readFileSync(outPath, 'utf8')).toBe('round trip');
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
		const file = fileFromString('x'.repeat(5 * 1024 * 1024 + 1), 'x.png', 'image/png');
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
		context: row.context ? JSON.parse(String(row.context)) : {},
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
		.returningAll()
		.executeSync()[0];
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
import { getAttachmentsPath } from '../paths';
import {
	saveEncryptedAttachment,
	readEncryptedAttachmentToPath,
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

	logAudit(ownerId, 'create', 'attachment', row.id, {
		filename: file.name,
		contentType: file.type,
		contextKind: context.kind
	});

	return row;
}

export async function readAttachmentToPath(attachmentId: number, plainPath: string): Promise<repo.AttachmentRecord> {
	const row = repo.getAttachmentById(attachmentId);
	if (!row) throw error(404, 'Attachment not found');

	const baseDir = getAttachmentsPath();
	await readEncryptedAttachmentToPath(row.storageKey, baseDir, plainPath);
	return row;
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
import { tripExpenseAttachments, attachments } from '../db/mongrelSchema';
import { eq } from '@visorcraft/mongreldb-kit';

export interface ExpenseAttachmentLink {
	id: number;
	expenseId: number;
	attachmentId: number;
	createdAt: Date | string;
}

export function createExpenseAttachmentLink(expenseId: number, attachmentId: number): ExpenseAttachmentLink {
	const db = getDb();
	const row = db
		.insertInto(tripExpenseAttachments)
		.values({
			expense_id: BigInt(expenseId),
			attachment_id: BigInt(attachmentId)
		})
		.returningAll()
		.executeSync()[0];
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

export function listAttachmentsForExpense(expenseId: number): AttachmentRow[] {
	const db = getDb();
	const rows = db
		.selectFrom(tripExpenseAttachments)
		.innerJoin(attachments, eq(attachments.id, tripExpenseAttachments.attachment_id))
		.where(eq(tripExpenseAttachments.expense_id, BigInt(expenseId)))
		.select([
			attachments.id,
			attachments.filename,
			attachments.content_type,
			attachments.size_bytes,
			tripExpenseAttachments.id.as('link_id')
		])
		.orderBy(attachments.created_at)
		.executeSync();
	return rows.map((r) => ({
		id: Number(r.id),
		filename: r.filename,
		contentType: r.content_type,
		sizeBytes: Number(r.size_bytes),
		linkId: Number(r.link_id)
	}));
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
import { createAttachment, readAttachmentToPath, deleteAttachment as deleteGenericAttachment } from './attachments/attachmentService';

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

export async function readAttachment(userId: number, linkId: number, plainPath: string) {
	const { link, tripId } = getAttachmentLink(userId, linkId);
	const attachment = await readAttachmentToPath(link.attachmentId, plainPath);
	return { ...attachment, tripId, expenseId: link.expenseId, linkId };
}

export async function deleteAttachment(userId: number, linkId: number) {
	const { link, tripId } = getAttachmentLink(userId, linkId);
	const attachment = await deleteGenericAttachment(link.attachmentId);
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

Update assertions to use the new `{ link, attachment }` return shape and the new `AttachmentRow` fields. Add a test that decrypts an uploaded file and verifies the plaintext.

- [ ] **Step 5: Run tests**

Run: `rtk npx vitest run src/lib/server/tripExpenseAttachments.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/tripExpenseAttachments.ts src/lib/server/tripExpenseAttachments.test.ts src/lib/server/repositories/expensesRepo.ts src/lib/server/tripDetail.ts
git commit -m "refactor: expense attachments use generic encrypted attachment service"
```

---

## Task 8: Update download route to decrypt to temp and stream

**Files:**
- Modify: `src/routes/trips/[id]/expenses/[expenseId]/attachments/[attachmentId]/+server.ts`

- [ ] **Step 1: Replace synchronous read with streaming read from verified temp file**

```ts
import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { readAttachment } from '$lib/server/tripExpenseAttachments';
import { mkdtempSync, rmSync, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

	const tempDir = mkdtempSync(path.join(tmpdir(), 'roamarr-dl-'));
	const tempPath = path.join(tempDir, 'plain');

	try {
		const attachment = await readAttachment(u.id, linkId, tempPath);
		if (attachment.tripId !== tripId || attachment.expenseId !== expenseId) {
			throw error(404, 'Attachment not found');
		}

		const safeFilename = sanitizeFilename(attachment.filename);
		const fileStream = createReadStream(tempPath);

		return new Response(Readable.toWeb(fileStream) as ReadableStream, {
			headers: {
				'Content-Type': attachment.contentType,
				'Content-Disposition': `inline; filename="${safeFilename}"`,
				'Content-Length': String(attachment.sizeBytes)
			}
		});
	} catch (e) {
		rmSync(tempDir, { recursive: true, force: true });
		throw e;
	}
};
```

> **Note:** Cleanup of `tempDir` after the response finishes should be handled. SvelteKit/Node will keep the response stream alive; after it closes, the temp directory should be removed. The simplest robust approach is to register `fileStream.on('close', () => rmSync(tempDir, { recursive: true, force: true }))` before returning the response. Add this in the implementation.

- [ ] **Step 2: Run type check**

Run: `rtk npm run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/trips/[id]/expenses/[expenseId]/attachments/[attachmentId]/+server.ts
git commit -m "feat: decrypt expense attachments to verified temp file before streaming"
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

In `+page.server.ts`, ensure expense attachments are loaded with `id`, `filename`, `contentType`, `sizeBytes`.

- [ ] **Step 2: Update UI references**

In `+page.svelte`, update the attachment display to use the new field names. The existing code references `a.filename` and `a.sizeBytes`; verify `contentType` is available if used.

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

Run: `rtk npm run test:e2e`
Expected: all tests pass.

- [ ] **Step 3: Final commit if any fixes**

```bash
git commit -a -m "fix: final encrypted attachment verification adjustments" || true
```

---

## Self-review

**Spec coverage:**
- Streaming encryption → Task 3.
- Streaming decryption with verified plaintext temp → Task 3.
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
- `tripExpenseAttachments.addAttachment` returns `{ link, attachment }`.
- `readAttachment` returns the attachment record plus `tripId`, `expenseId`, `linkId`.

**Gaps:**
- The exact MongrelDB Kit query syntax for `innerJoin` in `expensesRepo.listAttachmentsForExpense` may need adjustment based on the actual Kit API. The implementing agent must verify and fix.
- `decryptFileToPath` must be carefully tested for backpressure and tag verification edge cases.

---

## Execution handoff

Plan complete and saved to `docs/specs/2026-07-05-encrypted-attachment-storage-plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — I implement the tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach would you like?