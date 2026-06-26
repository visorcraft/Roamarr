# Codebase Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove root-level screenshot PNGs and dead/inaccessible code without affecting runtime behavior.

**Architecture:** This is a pure deletion and import-pruning pass. No feature logic changes. Changes are limited to: deleting untracked-but-committed screenshot files, removing one unused standalone script, removing one unused test helper, and removing confirmed-unused TypeScript imports.

**Tech Stack:** SvelteKit, TypeScript, SQLite, Vitest, Git.

---

### Task 1: Remove root-level screenshot PNGs

**Files:**
- Delete: `roamarr-*.png` at repo root (25 files)

**Rationale:** These are Playwright/MCP screenshot artifacts. They are not referenced by source, tests, docs, or config. `.gitignore` already contains `roamarr-*.png` to prevent future commits.

- [ ] **Step 1: List files to delete**

Run:
```bash
git ls-files 'roamarr-*.png'
```
Expected: 25 tracked PNG files at repo root.

- [ ] **Step 2: Delete the files**

Run:
```bash
git rm roamarr-*.png
```
Expected: Files removed from working tree and staged.

- [ ] **Step 3: Verify none remain**

Run:
```bash
ls -1 roamarr-*.png 2>/dev/null || echo 'none remain'
```
Expected: `none remain`

---

### Task 2: Remove unused standalone seed script

**Files:**
- Delete: `scripts/seed-container-db.ts`

**Rationale:** The script is not referenced in `package.json` scripts, Dockerfile, docs, or any source file. It imports `seedDemoData` but is itself unreachable.

- [ ] **Step 1: Confirm no references**

Run:
```bash
grep -R 'seed-container-db' --include='*.ts' --include='*.js' --include='*.json' --include='*.md' .
```
Expected: No matches (except possibly this plan).

- [ ] **Step 2: Delete the file**

Run:
```bash
git rm scripts/seed-container-db.ts
```

- [ ] **Step 3: Verify directory state**

Run:
```bash
ls scripts/
```
Expected: `seed-container-db.ts` is gone; `scripts/` may be empty.

---

### Task 3: Remove unused test helper

**Files:**
- Modify: `tests/eventHelpers.ts:72-85`

**Rationale:** `makeActionEvent` is exported but never imported by any test file. `makeFormEvent` and `makePostEvent` already cover form/action event construction.

- [ ] **Step 1: Verify no usages**

Run:
```bash
grep -R 'makeActionEvent' --include='*.ts' --include='*.svelte' src tests
```
Expected: Only the definition in `tests/eventHelpers.ts` matches.

- [ ] **Step 2: Remove the function**

Edit `tests/eventHelpers.ts` to delete lines 72-85:

```typescript
export function makeActionEvent(
	user: { id: number; email: string },
	params: Record<string, string>,
	formData: FormData,
	url = 'http://localhost/'
): RequestEvent {
	return {
		...baseEvent(user, params, url),
		request: {
			formData: async () => formData,
			method: 'POST'
		}
	} as unknown as RequestEvent;
}
```

- [ ] **Step 3: Verify tests still compile**

Run:
```bash
npm run check
```
Expected: `svelte-check` passes (no errors related to `tests/eventHelpers.ts`).

---

### Task 4: Remove unused imports

**Files:**
- Modify: `src/lib/server/loyaltyPrograms.ts:3`
- Modify: `src/lib/server/tripEntryRequirements.ts:1,3`

**Rationale:** `loyaltyPrograms.ts` uses `userCrudFactory` for DB access and never uses the `db` import. `tripEntryRequirements.ts` uses `tripCrudFactory` and never uses `eq` or `db`.

- [ ] **Step 1: Remove `db` import from `loyaltyPrograms.ts`**

Edit `src/lib/server/loyaltyPrograms.ts` line 3:

```typescript
import { db } from './db';
```
Change to: remove the entire line.

- [ ] **Step 2: Remove `eq` and `db` imports from `tripEntryRequirements.ts`**

Edit `src/lib/server/tripEntryRequirements.ts` line 1:

```typescript
import { asc, eq } from 'drizzle-orm';
```
Change to:
```typescript
import { asc } from 'drizzle-orm';
```

Edit `src/lib/server/tripEntryRequirements.ts` line 3:

```typescript
import { db } from './db';
```
Change to: remove the entire line.

- [ ] **Step 3: Verify no check errors**

Run:
```bash
npm run check
```
Expected: No TypeScript errors.

---

### Task 5: Run full verification

- [ ] **Step 1: Run type check**

```bash
npm run check
```
Expected: Passes with no errors.

- [ ] **Step 2: Run test suite**

```bash
npm test
```
Expected: All Vitest tests pass.

- [ ] **Step 3: Review git diff**

```bash
git status --short && git diff --stat
```
Expected: Deletions of `roamarr-*.png`, `scripts/seed-container-db.ts`, and small edits to `tests/eventHelpers.ts`, `src/lib/server/loyaltyPrograms.ts`, `src/lib/server/tripEntryRequirements.ts`.

---

## Self-Review

1. **Spec coverage:** The user asked to remove root-level PNGs and dead/inaccessible code. Each task maps to a discovered dead artifact.
2. **Placeholder scan:** No placeholders; all steps have exact commands.
3. **Type consistency:** No new types introduced; only deletions and import removals.
