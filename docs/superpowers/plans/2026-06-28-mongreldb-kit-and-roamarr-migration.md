# MongrelDB Kit + Roamarr SQLite Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MongrelDB Kit (`@mongreldb/kit`) persistence layer and migrate Roamarr from SQLite/Drizzle to MongrelDB Kit, completing both `PLAN.md` documents.

**Architecture:** A TypeScript-first `@mongreldb/kit` package in `visorcraft/mongreldb_kit` wraps the existing MongrelDB Node addon, adding schema DSL, constraints, migrations, and a query builder. Roamarr consumes the kit through repository modules and removes Drizzle/SQLite.

**Tech Stack:** Node.js 22, TypeScript ESM, Rust (MongrelDB core/NAPI), SvelteKit 2, Vitest.

---

## Phase A: Fix MongrelDB Node Addon Prerequisites

**Repository:** `/work/repos/visorcraft/mongreldb`
**Goal:** Close the gaps listed in Roamarr `PLAN.md` Phase 2 so the kit can rely on the engine.

**Files:**
- Modify: `crates/mongreldb-node/src/lib.rs`
- Modify: `crates/mongreldb-node/package.json`
- Test: `crates/mongreldb-node/smoke.mjs`

### Task A1: True 64-bit integer support

- [ ] **Step 1: Change `Cell.int64` from `Option<i32>` to `Option<i64>` and map through JS `BigInt`.**
- [ ] **Step 2: Change `ConditionSpec.int64_lo/hi` from `Option<i32>` to `Option<i64>`.**
- [ ] **Step 3: Update `Cell::to_value` and `from_value` to preserve full i64 range.**
- [ ] **Step 4: Update `build_condition` `RangeInt` to use i64 bounds.**
- [ ] **Step 5: Run `napi build` and update `smoke.mjs` to assert BigInt round-trip for `Int64`/`TimestampNanos`/`Date32`.**

### Task A2: Typed primary-key operations

- [ ] **Step 1: Add `ConditionKind::PkInt64` and `PkFloat64` variants that read `int64_lo`/`float64_lo`.**
- [ ] **Step 2: Add `TableHandle.get_by_pk_text/cells` helpers (encoded text PK path).**
- [ ] **Step 3: Add `TableHandle.delete(row_id: BigInt)` and `delete_by_pk_*` helpers.**
- [ ] **Step 4: Extend smoke tests to cover PK lookup/delete by text and int64.**

### Task A3: Catalog-aware `addColumn`

- [ ] **Step 1: Expose `Database.add_column(table: String, column: ColumnSpec)` through NAPI.**
- [ ] **Step 2: Validate that added columns are nullable or have a kit-provided default; reject non-null-without-default.**
- [ ] **Step 3: Smoke-test adding a nullable Int64 column to an existing table.**

### Task A4: Backup and integrity primitives

- [ ] **Step 1: Expose `Database.check()` and `Database.doctor()` through NAPI returning a JSON-string summary.**
- [ ] **Step 2: Expose `Database.snapshot_directory()` returning the database directory path.**
- [ ] **Step 3: Smoke-test check/doctor on a fresh database.**

### Task A5: Error taxonomy and ConflictError wrapper

- [ ] **Step 1: Restore the hand-written `index.js` wrapper that re-exports generated bindings plus `ConflictError` and a `transaction(fn, {retries})` helper.**
- [ ] **Step 2: Map core error categories to stable string prefixes (`__CONFLICT__`, `__NOT_FOUND__`, `__INVALID__`, `__CORRUPTION__`).**
- [ ] **Step 3: Smoke-test retryable conflict detection and the wrapper helper.**

### Task A6: Stable Node package story

- [ ] **Step 1: Ensure `napi build --release --platform` produces `index.js`, `index.d.ts`, and the `.node` binary deterministically.**
- [ ] **Step 2: Add `files` array to `package.json` so the package can be consumed by path.**
- [ ] **Step 3: Build and commit the generated artifacts.**

**Verification:**
```sh
cd /work/repos/visorcraft/mongreldb/crates/mongreldb-node
rtk npm run build
rtk node smoke.mjs
```

**Commit:** `fix(node): 64-bit PKs, addColumn, check/doctor, error taxonomy`

---

## Phase B: Bootstrap MongrelDB Kit Repository

**Repository:** `/work/repos/visorcraft/mongreldb_kit`
**Goal:** Create the repository layout and TypeScript package skeleton.

**Files:**
- Create: `packages/kit/package.json`
- Create: `packages/kit/tsconfig.json`
- Create: `packages/kit/src/index.ts`
- Create: `packages/kit/src/schema.ts`
- Create: `packages/kit/src/types.ts`
- Create: `packages/kit/src/db.ts`
- Create: `packages/kit/vitest.config.ts`
- Modify: `packages/kit/PLAN.md` if conventions change

### Task B1: Repository layout

- [ ] **Step 1: Create `packages/kit/` with `package.json` naming the package `@mongreldb/kit`, ESM, Node 22.**
- [ ] **Step 2: Add `tsconfig.json` with strict settings and ESM output.**
- [ ] **Step 3: Add `vitest.config.ts` with in-source test support.**
- [ ] **Step 4: Add a workspace-local dependency on the `mongreldb` Node addon via relative path.**

### Task B2: Core schema model (TypeScript)

- [ ] **Step 1: Define `ColumnType`, `Column`, `Table`, `Index`, `UniqueConstraint`, `ForeignKey`, `CheckConstraint`, `Sequence` types.**
- [ ] **Step 2: Define `Schema` class with `table()`, `toJSON()`, and stable table/column ID validation.**
- [ ] **Step 3: Add helpers `integer()`, `text()`, `real()`, `boolean()`, `blob()`, `json()`, `timestamp()`, `date()` to build columns.**
- [ ] **Step 4: Add `pk()`, `unique()`, `foreignKey()`, `check()`, `index()` table builders.**

### Task B3: Type inference

- [ ] **Step 1: Infer `Row<T>` from column nullability, defaults, and generated values.**
- [ ] **Step 2: Infer `Insert<T>` (omit generated/defaulted required columns).**
- [ ] **Step 3: Infer `Update<T>` (partial, all columns optional).**
- [ ] **Step 4: Add a type test file using Vitest type assertions.**

**Verification:**
```sh
cd /work/repos/visorcraft/mongreldb_kit/packages/kit
rtk npm install
rtk npm run check
rtk npm test
```

**Commit:** `feat(kit): bootstrap @mongreldb/kit schema DSL and types`

---

## Phase C: Kit Core Constraints and Query Builder

**Repository:** `/work/repos/visorcraft/mongreldb_kit`
**Goal:** Implement defaults, validation, unique/FK enforcement, and a query builder backed by MongrelDB.

### Task C1: Defaults and validation

- [ ] **Step 1: Implement default providers: static scalar, `now`, `uuid`, and sequence.**
- [ ] **Step 2: Apply defaults before validation on insert; do not reapply on update.**
- [ ] **Step 3: Implement validators: not-null, type, enum, range, length, regex, JSON parseability, custom check.**

### Task C2: Internal kit tables

- [ ] **Step 1: On `openDatabase`, create `__kit_schema_migrations`, `__kit_schema_catalog`, `__kit_sequences`, `__kit_unique_keys`, `__kit_row_guards`.**
- [ ] **Step 2: Provide functions to read/write migration rows and sequences.**
- [ ] **Step 3: Hide internal tables from application table enumeration.**

### Task C3: Unique constraints

- [ ] **Step 1: Define stable unique-key encoding including version, constraint name, typed components, and null markers.**
- [ ] **Step 2: On insert, compute guard keys, check for conflicts, and write guard rows atomically via `Transaction`.**
- [ ] **Step 3: On update, delete stale guards and write new guards atomically.**
- [ ] **Step 4: On delete, remove all guards for the row.**

### Task C4: Foreign keys and row guards

- [ ] **Step 1: On child insert/update with non-null FK, verify parent exists and touch `__kit_row_guards`.**
- [ ] **Step 2: Implement cascade delete planner that materializes child PKs recursively.**
- [ ] **Step 3: Implement set-null delete planner with validation.**
- [ ] **Step 4: Implement restrict delete planner.**

### Task C5: Query builder

- [ ] **Step 1: Build a typed `select().from().where().orderBy().limit().offset()` API.**
- [ ] **Step 2: Support `eq`, `ne`, `in`, `notIn`, `gt`, `gte`, `lt`, `lte`, `isNull`, `isNotNull`, `and`, `or`.**
- [ ] **Step 3: Support projections and counting.**
- [ ] **Step 4: Build typed `insert().values()` and `update().set().where()` and `delete().where()` APIs using the constraint pipeline.**

### Task C6: Migration runner

- [ ] **Step 1: Implement ordered migrations with checksums and `__kit_schema_migrations`.**
- [ ] **Step 2: Implement `createTable`, `dropTable`, `addColumn`, `addIndex`, `addUnique`, `addForeignKey` migration operations.**
- [ ] **Step 3: Provide `migrate()` function that creates internal tables, applies pending migrations, and seeds sequences.**

**Verification:**
```sh
cd /work/repos/visorcraft/mongreldb_kit/packages/kit
rtk npm test
```

**Commit:** `feat(kit): constraints, query builder, and migration runner`

---

## Phase D: Translate Roamarr Schema to Kit DSL

**Repository:** `/work/repos/visorcraft/roamarr`
**Goal:** Define the Roamarr application schema in `@mongreldb/kit` terms.

**Files:**
- Create: `src/lib/server/db/mongrelSchema.ts`
- Create: `src/lib/server/db/mongrelMigrations/0001_initial.ts`
- Create: `src/lib/server/db/mongrel.ts`

### Task D1: Schema translation

- [ ] **Step 1: Translate all 43 tables from `src/lib/server/db/schema.ts` into kit schema DSL.**
- [ ] **Step 2: Preserve current column names and app-visible primary-key behavior.**
- [ ] **Step 3: Define all enum/check constraints currently represented by SQLite checks.**
- [ ] **Step 4: Define every foreign key with delete action (cascade/set null/restrict).**
- [ ] **Step 5: Define every unique and composite unique constraint.**
- [ ] **Step 6: Define indexes for owner/user FKs, trip FKs, status/date filters, GeoNames, tokens, scheduler due scans.**

### Task D2: Initial migration

- [ ] **Step 1: Write `0001_initial.ts` that creates all Roamarr tables, indexes, constraints, and seeds settings row id 1 plus default benefit templates.**
- [ ] **Step 2: Add a migration runner invocation in `src/lib/server/db/mongrel.ts`.**
- [ ] **Step 3: Add a temp-database test fixture helper for Vitest.**

**Verification:**
```sh
cd /work/repos/visorcraft/roamarr
rtk npm run check
rtk npx vitest run src/lib/server/db/mongrelSchema.test.ts
```

**Commit:** `feat(db): Roamarr schema as MongrelDB Kit DSL`

---

## Phase E: Replace Roamarr DB Access

**Repository:** `/work/repos/visorcraft/roamarr`
**Goal:** Incrementally replace Drizzle call sites with kit repositories.

### Task E1: DB boot and connection

- [ ] **Step 1: Replace `createDb.ts` and `db/index.ts` to open a MongrelDB directory via `@mongreldb/kit`.**
- [ ] **Step 2: Update `boot.ts` to apply kit migrations and seed settings/benefit templates.**
- [ ] **Step 3: Update `hooks.server.ts` to use the new db singleton.**

### Task E2: Repository modules

Create one repository module per domain area under `src/lib/server/repositories/`:

- [ ] `usersRepo.ts` – users, sessions, password reset tokens.
- [ ] `settingsRepo.ts` – settings singleton.
- [ ] `tripsRepo.ts` – trips, trip comments, shares.
- [ ] `segmentsRepo.ts` – segments, attendees.
- [ ] `profileRepo.ts` – travel documents, loyalty, cards, benefits, insurance.
- [ ] `expensesRepo.ts` – expenses and attachments.
- [ ] `remindersRepo.ts` – reminders, notifications, scheduler runs.
- [ ] `geonamesRepo.ts` – GeoNames import and city search.
- [ ] `adminRepo.ts` – audit logs, admin queries, demo seed.

### Task E3: Update routes

- [ ] **Step 1: Update `+page.server.ts` and `+server.ts` files to call repositories instead of `db.select/insert/update/delete`.**
- [ ] **Step 2: Keep routes thin; do not expose raw MongrelDB handles.**
- [ ] **Step 3: Update shared helpers (`crud.ts`, `ownership.ts`, `sharing.ts`) to use repositories.**

**Verification:**
```sh
rtk npm run check
rtk npm test
```

**Commit per domain area.** Example: `refactor(repo): trips and sharing on MongrelDB Kit`

---

## Phase F: Backup, Restore, and Health

**Repository:** `/work/repos/visorcraft/roamarr`
**Goal:** Replace SQLite-specific backup/restore/health with MongrelDB directory operations.

### Task F1: Backup

- [ ] **Step 1: In `src/routes/settings/backup/+server.ts`, archive the MongrelDB directory and attachments directory to a `.tar.gz` or `.zip`.**
- [ ] **Step 2: Name the download `roamarr-backup-<iso>.mongreldb.tar.gz`.**
- [ ] **Step 3: Update UI copy and accepted file types.**

### Task F2: Restore

- [ ] **Step 1: In `src/routes/settings/backup/+page.server.ts`, unpack the archive to a temp directory.**
- [ ] **Step 2: Run `Database.doctor()` / integrity check on the unpacked directory.**
- [ ] **Step 3: Verify required tables exist in the catalog.**
- [ ] **Step 4: Atomically replace the current data directory on restart (write a pending restore marker and swap on next boot).**

### Task F3: Health

- [ ] **Step 1: In `src/routes/health/+server.ts`, check that the data directory is accessible and scheduler is running.**
- [ ] **Step 2: In `src/routes/health/deep/+server.ts`, call kit integrity check plus a minimal read against `__kit_schema_migrations`.**

**Verification:**
```sh
rtk npm test
```

**Commit:** `feat(ops): MongrelDB directory backup/restore and health checks`

---

## Phase G: Tests and Fixtures

**Repository:** `/work/repos/visorcraft/roamarr`
**Goal:** Move tests from SQLite in-memory to MongrelDB temp directories.

### Task G1: Test fixtures

- [ ] **Step 1: Replace `freshDb()` with `freshMongrelDb()` that creates a temp directory, applies kit migrations, and seeds.**
- [ ] **Step 2: Replace `resetTables()` with a kit helper that truncates tables in FK-safe order or recreates the temp directory.**
- [ ] **Step 3: Update `makeUser`, `makeTrip`, `makeSegment`, `makeCompanion` to use repositories.**

### Task G2: Test migration

- [ ] **Step 1: Update existing server-lib tests to use the new fixture.**
- [ ] **Step 2: Update route/action tests to use the new fixture.**
- [ ] **Step 3: Add focused tests for cascade deletes that matter to Roamarr data integrity.**
- [ ] **Step 4: Add backup/restore archive validation tests.**
- [ ] **Step 5: Add migration boot test for empty DB.**

**Verification:**
```sh
rtk npm run check
rtk npm test
```

**Commit:** `test: run suite against MongrelDB temp directories`

---

## Phase H: Remove SQLite and Drizzle

**Repository:** `/work/repos/visorcraft/roamarr`
**Goal:** Delete all SQLite/Drizzle artifacts after the app no longer depends on them.

### Task H1: Remove dependencies and artifacts

- [ ] **Step 1: Delete `drizzle/` directory.**
- [ ] **Step 2: Delete `drizzle.config.ts`.**
- [ ] **Step 3: Remove `drizzle-kit`, `drizzle-orm`, `better-sqlite3`, and `@types/better-sqlite3` from `package.json`.**
- [ ] **Step 4: Remove `src/lib/server/db/schema.ts` and `schemaHelpers.ts` if no longer referenced.**

### Task H2: Update documentation

- [ ] **Step 1: Regenerate license credits with `rtk npm run credits:generate`.**
- [ ] **Step 2: Update `README.md` badges/docs to describe MongrelDB directory storage.**
- [ ] **Step 3: Update `.env.example` to clarify `DATABASE_PATH` points to a MongrelDB directory.**
- [ ] **Step 4: Update `AGENTS.md` storage conventions and commands.**
- [ ] **Step 5: Update container/deployment docs for MongrelDB directory storage.**

**Verification:**
```sh
rtk npm run check
rtk npm test
rtk npm run credits:generate
```

**Commit:** `chore: remove Drizzle/SQLite and update docs`

---

## Final Verification and Delivery

### Task FV1: Full validation

- [ ] **Step 1: Run `rtk npm run check` in both repositories.**
- [ ] **Step 2: Run `rtk npm test` in both repositories.**
- [ ] **Step 3: Run `rtk npm run build` in Roamarr.**

### Task FV2: Peer review per phase

- [ ] **Step 1: After each phase commit, dispatch a coder subagent to review the diff against the PLAN.md requirements for that phase.**
- [ ] **Step 2: Fix any legitimate issues found and re-review until approved.**

### Task FV3: Commit and push

- [ ] **Step 1: Ensure each phase is committed with a short, human-written message (no AI contributor names).**
- [ ] **Step 2: Push `master` in both repositories once all phases are complete and reviewed.**
- [ ] **Step 3: Compact context after each push.**

---

## Spec Coverage Check

| PLAN.md requirement | Implementing phase |
|---|---|
| MongrelDB Kit TypeScript package | B, C |
| Schema DSL + type inference | B |
| Defaults, validation, checks | C1 |
| Unique/composite unique | C3 |
| FK existence, cascade/set-null/restrict | C4 |
| Query builder | C5 |
| Migration runner | C6 |
| Roamarr schema translation | D |
| Replace Drizzle call sites | E |
| Backup/restore/health | F |
| Tests on temp MongrelDB dirs | G |
| Remove Drizzle/SQLite | H |
| Peer review per phase | FV2 |

**Remaining risks:** Rust core/Python bindings and full conformance suite are deferred until TypeScript/Roamarr path is working; the first complete public release criteria for Rust/Python are tracked in `mongreldb_kit/PLAN.md` and should follow the same phase pattern.
