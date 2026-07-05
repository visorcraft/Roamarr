# Encrypted Attachment Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plaintext expense-receipt files on disk with chunked AES-256-GCM ciphertext, add a generic `attachments` subsystem, and preserve the existing upload/download interfaces while never writing a plaintext temp file during download.

**Architecture:** Three layers: `attachmentCrypto` (chunked AES-256-GCM), `attachmentStorage` (sharded ciphertext files), and `attachmentService` (generic metadata CRUD). Expense attachment code delegates storage to the generic service and keeps trip-based authorization. The ciphertext format is version 2 with a per-chunk auth tag and an authenticated footer chunk for truncation detection.

**Tech Stack:** Node.js `crypto`, SvelteKit form actions, `node:fs` streams, MongrelDB Kit, Vitest, Playwright.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/server/attachments/attachmentCrypto.ts` | Chunked AES-256-GCM: `encryptChunkedFile`, `decryptChunkedFileStream`. |
| `src/lib/server/attachments/attachmentCrypto.test.ts` | Crypto round-trip, tampering, truncation, size-limit tests. |
| `src/lib/server/attachments/attachmentStorage.ts` | Sharded ciphertext: `saveEncryptedAttachment`, `readEncryptedAttachmentStream`, `deleteEncryptedAttachment`. |
| `src/lib/server/attachments/attachmentStorage.test.ts` | Storage path and save/read/delete tests. |
| `src/lib/server/attachments/attachmentRepo.ts` | MongrelDB queries for the generic `attachments` table. |
| `src/lib/server/attachments/attachmentService.ts` | Generic service: `createAttachment`, `readAttachmentStream`, `deleteAttachment`, validation, audit. |
| `src/lib/server/attachments/attachmentService.test.ts` | Service-layer tests. |
| `src/lib/server/paths.ts` | `getAttachmentsPath` with `ATTACHMENTS_PATH` and directory/file detection. |
| `src/lib/server/paths.test.ts` | Path resolution tests. |
| `src/lib/server/restore.ts` | Use the same attachment path logic as runtime. |
| `src/lib/server/db/mongrelSchema.ts` | Add generic `attachments` table; change `trip_expense_attachments` to link table. |
| `src/lib/server/db/mongrelMigrations/0013_attachments_table.ts` | Drop old link table, create new tables. |
| `src/lib/server/db/mongrelMigrations/index.ts` | Register migration 13. |
| `src/lib/server/crypto.ts` / `crypto.test.ts` | Expose binary AES key helper. |
| `src/lib/server/repositories/expensesRepo.ts` | New link helpers and updated `AttachmentRow`. |
| `src/lib/server/repositories/expensesRepo.test.ts` | Updated attachment CRUD tests. |
| `src/lib/server/tripExpenseAttachments.ts` | Delegate to generic service; enforce trip auth. |
| `src/lib/server/tripExpenseAttachments.test.ts` | Updated expense attachment tests. |
| `src/routes/trips/[id]/expenses/[expenseId]/attachments/[attachmentId]/+server.ts` | Stream decrypted chunks as response. |
| `src/routes/trips/[id]/+page.svelte` / `+page.server.ts` | Use new `AttachmentRow` shape. |
| `tests/helpers.ts` | Update `makeAttachment` for new schema. |
| `tests/e2e/expenses.spec.ts` or `attachments.spec.ts` | Encrypted upload/download E2E test. |

---

## Task 1: Update `getAttachmentsPath` and align restore

**Files:**
- Modify: `src/lib/server/paths.ts`
- Modify: `src/lib/server/restore.ts`
- Test: `src/lib/server/paths.test.ts`

- [ ] **Step 1: Write the failing tests**

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

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk npx vitest run src/lib/server/paths.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `paths.ts`**

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

- [ ] **Step 4: Align `restore.ts`**

In `src/lib/server/restore.ts`, remove the local `getAttachmentsPath` function and import from `../paths`:

```ts
import { getAttachmentsPath } from '../paths';
```

Adjust any call sites so they use the imported function with no arguments.

- [ ] **Step 5: Run tests**

Run: `rtk npx vitest run src/lib/server/paths.test.ts src/lib/server/restore.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/paths.ts src/lib/server/paths.test.ts src/lib/server/restore.ts
git commit -m "fix: getAttachmentsPath respects ATTACHMENTS_PATH and database directory paths"
```

---

## Task 2: Expose binary AES key helper

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
Expected: FAIL.

- [ ] **Step 3: Export the helper**

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

## Task 3: Implement chunked attachment crypto

**Files:**
- Create: `src/lib/server/attachments/attachmentCrypto.ts`
- Create: `src/lib/server/attachments/attachmentCrypto.test.ts`

Use the complete `attachmentCrypto.ts` and test file from the approved spec at `docs/specs/2026-07-05-encrypted-attachment-storage-plan.md` § Task 3. The implementation includes:

- Version 2 format with header, chunked ciphertext, and authenticated footer.
- `encryptChunkedFile(input, outputPath, { maxBytes })` returning `{ plaintextBytes, chunkCount }`.
- `decryptChunkedFileStream(cipherPath)` returning a web `ReadableStream<Uint8Array>` via an async generator.
- Domain-separated attachment key via `scryptSync(aesKey(), 'roamarr.attachments.v1', 32)`.

- [ ] **Step 1: Write tests from the spec**

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk npx vitest run src/lib/server/attachments/attachmentCrypto.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `attachmentCrypto.ts` from the spec**

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

Use the complete `attachmentStorage.ts` and test file from the approved spec at `docs/specs/2026-07-05-encrypted-attachment-storage-plan.md` § Task 4. The implementation includes:

- `attachmentPath(storageKey, baseDir)` sharded UUID path.
- `saveEncryptedAttachment(input, baseDir)` returning `{ storageKey, plaintextBytes, chunkCount }`.
- `readEncryptedAttachmentStream(storageKey, baseDir)` returning `ReadableStream<Uint8Array>`.
- `deleteEncryptedAttachment(storageKey, baseDir)`.

- [ ] **Step 1: Write tests from the spec**

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk npx vitest run src/lib/server/attachments/attachmentStorage.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `attachmentStorage.ts` from the spec**

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
- Create: `src/lib/server/db/mongrelMigrations/0013_attachments_table.ts`
- Modify: `src/lib/server/db/mongrelMigrations/index.ts`

Use the schema and migration from the approved spec at `docs/specs/2026-07-05-encrypted-attachment-storage-plan.md` § Task 5. Key points:

- Add `attachments` table before `tripExpenseAttachments` in the `Schema` constructor.
- Change `trip_expense_attachments` to `expense_id` + `attachment_id` link table.
- Migration drops the old link table and calls `ctx.ensureTable(attachments)` and `ctx.ensureTable(tripExpenseAttachments)`.
- Register migration 13 in `index.ts`.

- [ ] **Step 1: Update `mongrelSchema.ts` from the spec**

- [ ] **Step 2: Write migration `0013_attachments_table.ts` from the spec**

- [ ] **Step 3: Register migration in `index.ts`**

- [ ] **Step 4: Run type check**

Run: `rtk npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/db/mongrelSchema.ts src/lib/server/db/mongrelMigrations/0013_attachments_table.ts src/lib/server/db/mongrelMigrations/index.ts
git commit -m "feat: generic attachments table and expense attachment link table"
```

---

## Task 6: Build generic attachment service

**Files:**
- Create: `src/lib/server/attachments/attachmentRepo.ts`
- Create: `src/lib/server/attachments/attachmentService.ts`
- Create: `src/lib/server/attachments/attachmentService.test.ts`

Use the complete files from the approved spec at `docs/specs/2026-07-05-encrypted-attachment-storage-plan.md` § Task 6. Key behavior:

- `createAttachment` validates type, enforces 10 MB via streamed byte count, stages ciphertext, inserts DB row, then renames to final key.
- `readAttachmentStream` returns `{ stream, record }`.
- `deleteAttachment` removes ciphertext and DB row.
- `MAX_SIZE = 10 * 1024 * 1024`.

- [ ] **Step 1: Write tests from the spec**

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk npx vitest run src/lib/server/attachments/attachmentService.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `attachmentRepo.ts` from the spec**

- [ ] **Step 4: Implement `attachmentService.ts` from the spec**

- [ ] **Step 5: Run tests to verify they pass**

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
- Modify: `src/lib/server/repositories/expensesRepo.ts`
- Modify: `src/lib/server/tripExpenseAttachments.ts`
- Modify: `src/lib/server/tripDetail.ts` (if needed)

Use the updated helpers and `tripExpenseAttachments.ts` from the approved spec at `docs/specs/2026-07-05-encrypted-attachment-storage-plan.md` § Task 7. Key points:

- `AttachmentRow.id` is the link id; `attachmentId` is the generic attachment id.
- `listAttachmentsForExpense` uses `innerJoin` with `joinEq` and sorts in JS.
- `tripExpenseAttachments` delegates to `attachmentService` and enforces `requireEditableTrip`.

- [ ] **Step 1: Update `expensesRepo.ts` from the spec**

- [ ] **Step 2: Update `tripExpenseAttachments.ts` from the spec**

- [ ] **Step 3: Check `tripDetail.ts`**

Verify `listAttachments(e.id)` is consumed only through the new `AttachmentRow` fields (`id`, `attachmentId`, `filename`, `contentType`, `sizeBytes`, `createdAt`).

- [ ] **Step 4: Run tests**

Run: `rtk npx vitest run src/lib/server/tripExpenseAttachments.test.ts`
Expected: PASS (tests are updated in Task 7b).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/tripExpenseAttachments.ts src/lib/server/repositories/expensesRepo.ts src/lib/server/tripDetail.ts
git commit -m "refactor: expense attachments use generic encrypted attachment service"
```

---

## Task 7b: Update attachment helpers and existing tests

**Files:**
- Modify: `tests/helpers.ts`
- Modify: `src/lib/server/repositories/expensesRepo.test.ts`
- Modify: `src/lib/server/tripExpenseAttachments.test.ts`

Use the instructions from the approved spec at `docs/specs/2026-07-05-encrypted-attachment-storage-plan.md` § Task 7b. Key changes:

- Add `attachments` to `tests/helpers.ts` imports; update `makeAttachment` to create both rows.
- Rewrite `expensesRepo.test.ts` attachment CRUD test for the new link helpers.
- Update `tripExpenseAttachments.test.ts` for the `{ link, attachment }` return shape, remove `getAttachmentWithPath`, use `readAttachmentStream`, set `ATTACHMENTS_PATH` to a temp dir, and expect 10 MB limit.

- [ ] **Step 1: Update `tests/helpers.ts` from the spec**

- [ ] **Step 2: Update `expensesRepo.test.ts` from the spec**

- [ ] **Step 3: Update `tripExpenseAttachments.test.ts` from the spec**

- [ ] **Step 4: Run tests**

Run: `rtk npx vitest run src/lib/server/repositories/expensesRepo.test.ts src/lib/server/tripExpenseAttachments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers.ts src/lib/server/repositories/expensesRepo.test.ts src/lib/server/tripExpenseAttachments.test.ts
git commit -m "test: update attachment helpers and tests for generic encrypted attachments"
```

---

## Task 8: Update download route

**Files:**
- Modify: `src/routes/trips/[id]/expenses/[expenseId]/attachments/[attachmentId]/+server.ts`

Use the route from the approved spec at `docs/specs/2026-07-05-encrypted-attachment-storage-plan.md` § Task 8. It streams the decrypted `ReadableStream` directly and uses `Content-Disposition: attachment`.

- [ ] **Step 1: Replace route implementation from the spec**

- [ ] **Step 2: Run type check**

Run: `rtk npm run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/trips/[id]/expenses/[expenseId]/attachments/[attachmentId]/+server.ts
git commit -m "feat: stream expense attachments as chunked decrypted bytes"
```

---

## Task 9: Verify upload form action needs no change

**Files:**
- `src/lib/server/tripMetaActions.ts`

- [ ] **Step 1: Confirm `addAttachmentAction` passes the `File` object**

No code change should be required because `attachmentService.createAttachment` accepts a `File` and calls `file.stream()`.

- [ ] **Step 2: Run type check**

Run: `rtk npm run check`
Expected: PASS.

---

## Task 10: Update UI to use new attachment shape

**Files:**
- Modify: `src/routes/trips/[id]/+page.server.ts`
- Modify: `src/routes/trips/[id]/+page.svelte`

Use the instructions from the approved spec at `docs/specs/2026-07-05-encrypted-attachment-storage-plan.md` § Task 10. `AttachmentRow.id` is now the link id, so existing URL construction with `a.id` remains correct.

- [ ] **Step 1: Update data load if needed**

- [ ] **Step 2: Update UI references to use `contentType`, `sizeBytes`, etc.**

- [ ] **Step 3: Run type check**

Run: `rtk npm run check`
Expected: PASS.

- [ ] **Step 4: Commit if changes made**

```bash
git add src/routes/trips/[id]/+page.svelte src/routes/trips/[id]/+page.server.ts
git commit -m "fix: adapt expense attachment UI to generic attachment schema"
```

---

## Task 11: Add E2E coverage

**Files:**
- Modify: `tests/e2e/expenses.spec.ts` or create `tests/e2e/attachments.spec.ts`

Use the E2E test from the approved spec at `docs/specs/2026-07-05-encrypted-attachment-storage-plan.md` § Task 11. Because the route returns `Content-Disposition: attachment`, Playwright will emit a download event.

- [ ] **Step 1: Add the E2E test from the spec**

- [ ] **Step 2: Run the spec**

Run: `rtk npx playwright test tests/e2e/expenses.spec.ts --project=e2e`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/expenses.spec.ts
git commit -m "test: e2e coverage for encrypted receipt upload/download"
```

---

## Task 12: Full verification

- [ ] **Step 1: Type check**

Run: `rtk npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 2: Unit tests**

Run: `rtk npm test`
Expected: all tests pass.

- [ ] **Step 3: E2E tests**

Run: `rtk npx playwright test`
Expected: all tests pass.

- [ ] **Step 4: Final commit if fixes needed**

```bash
git commit -a -m "fix: final encrypted attachment verification adjustments" || true
```

---

## Self-review

**Spec coverage:**
- Chunked AES-256-GCM file format and crypto → Tasks 2, 3.
- No plaintext temp files during download → Task 3.
- Generic attachments schema/migration → Task 5.
- Generic attachment service with 10 MB limit → Task 6.
- Expense receipt refactor and link-table helpers → Tasks 7, 7b.
- Streaming download route → Task 8.
- UI adaptation → Task 10.
- E2E coverage → Task 11.

**Placeholder scan:**
- No TBD/TODO/filler steps.
- Code blocks are in the approved spec; this plan points to the exact spec sections.

**Type consistency:**
- `encryptChunkedFile` returns `{ plaintextBytes, chunkCount }`.
- `saveEncryptedAttachment` extends that with `storageKey`.
- `createAttachment` stores `plaintextBytes` as `sizeBytes`.
- `readAttachmentStream` returns `{ stream: ReadableStream<Uint8Array>, record }`.
- `AttachmentRow.id` is the link id, `attachmentId` is the generic id.

---

## Execution handoff

Plan complete and saved to `docs/specs/2026-07-05-encrypted-attachment-implementation-plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach would you like?
