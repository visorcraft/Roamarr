# Roamarr: 10 Missing Traveler Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement ten shallow, traveler-centric features on top of the existing Roamarr v0.1 walking skeleton, without adding or changing themes.

**Architecture:** Each feature adds a small schema change, a focused server module under `src/lib/server/`, thin route wiring in the existing trip-detail route, and a co-located test. File uploads use a configurable `ATTACHMENTS_DIR` directory with a secure download endpoint.

**Tech Stack:** SvelteKit 2, Svelte 5, TypeScript, Drizzle ORM, SQLite (`better-sqlite3`), Luxon, Vitest.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/server/db/schema.ts` | Add all new columns and tables |
| `drizzle/0019_*` (generated) | Migration produced by `npm run db:generate` |
| `src/lib/server/tripExpenseAttachments.ts` | Upload, list, delete, and stream receipt attachments |
| `src/routes/trips/[id]/expenses/[expenseId]/attachments/[attachmentId]/+server.ts` | Secure attachment download endpoint |
| `src/lib/server/tripTemplates.ts` | Save/load templates and create trips from them |
| `src/routes/trips/new/+page.server.ts` | Add template selector to new-trip flow |
| `src/lib/server/tripHomeTasks.ts` | Home-preparation task CRUD |
| `src/lib/server/tripMedications.ts` | Medication schedule CRUD |
| `src/lib/server/tripEntryRequirements.ts` | Visa/vaccination tracker CRUD |
| `src/lib/server/tripImportantItems.ts` | Valuables registry CRUD |
| `src/lib/server/tripExpenses.ts` | Add multi-currency rate/base-amount support |
| `src/lib/server/tripCompanions.ts` | Add kid gear and preference fields |
| `src/lib/server/segments.ts` | Add payment status / due date update support |
| `src/routes/trips/[id]/+page.server.ts` | Wire new load data and actions |
| `src/routes/trips/[id]/+page.svelte` | Add UI sections for each feature |
| `src/routes/trips/[id]/edit/+page.server.ts` | Add `baseCurrency` to trip edit |
| `*.test.ts` | Co-located server and route tests |

---

## Common Patterns

- Authorization: `requireEditableTrip(userId, tripId)` for mutations; `requireOwnedTrip` for ownership-only actions.
- Audit: every create/update/delete calls `logAudit(userId, action, entityType, entityId, meta)`.
- Validation: use `Validator` from `src/lib/server/validation.ts`; invalid input returns `fail(400, ...)`.
- DB mock in tests:
  ```ts
  const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
  vi.mock('./db', async () => {
    const { freshDb } = await import('../../../tests/helpers');
    Object.assign(ctx, freshDb());
    return ctx;
  });
  ```

---

## Task 1: Schema changes for all ten features

**Files:**
- Modify: `src/lib/server/db/schema.ts`

- [ ] **Step 1: Add tables and columns**

  ```ts
  // trips
  baseCurrency: text('base_currency').notNull().default('USD'),

  // trip_companions
  needsCarSeat: integer('needs_car_seat', { mode: 'boolean' }).notNull().default(false),
  needsStroller: integer('needs_stroller', { mode: 'boolean' }).notNull().default(false),
  needsCrib: integer('needs_crib', { mode: 'boolean' }).notNull().default(false),
  needsKidsMeal: integer('needs_kids_meal', { mode: 'boolean' }).notNull().default(false),
  childTicketDiscount: text('child_ticket_discount'),
  seatPreference: text('seat_preference'),
  bedPreference: text('bed_preference'),
  accessibilityNeeds: text('accessibility_needs'),
  roomNotes: text('room_notes'),

  // segments
  paymentStatus: text('payment_status').notNull().default('quoted'),
  paymentDueDate: text('payment_due_date'),

  // trip_expenses
  exchangeRate: integer('exchange_rate').notNull().default(10000),
  baseAmount: integer('base_amount').notNull().default(0),

  // new tables
  export const tripExpenseAttachments = sqliteTable('trip_expense_attachments', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    expenseId: integer('expense_id').notNull().references(() => tripExpenses.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    createdAt: text('created_at').notNull().default(now)
  });

  export const tripTemplates = sqliteTable('trip_templates', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sourceTripId: integer('source_trip_id').references(() => trips.id, { onDelete: 'set null' }),
    snapshotJson: text('snapshot_json').notNull(),
    createdAt: text('created_at').notNull().default(now)
  });

  export const tripHomeTasks = sqliteTable('trip_home_tasks', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tripId: integer('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    dueDate: text('due_date'),
    done: integer('done', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull().default(now)
  });

  export const tripMedications = sqliteTable('trip_medications', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tripId: integer('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
    companionId: integer('companion_id').references(() => tripCompanions.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    dosage: text('dosage'),
    schedule: text('schedule'),
    startsAt: text('starts_at'),
    endsAt: text('ends_at'),
    notes: text('notes'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now)
  });

  export const tripEntryRequirements = sqliteTable('trip_entry_requirements', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tripId: integer('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
    country: text('country').notNull(),
    requirementType: text('requirement_type').notNull(),
    status: text('status').notNull().default('needed'),
    dueDate: text('due_date'),
    notes: text('notes'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now)
  });

  export const tripImportantItems = sqliteTable('trip_important_items', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tripId: integer('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
    companionId: integer('companion_id').references(() => tripCompanions.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    serialNumber: text('serial_number'),
    trackerId: text('tracker_id'),
    notes: text('notes'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now)
  });
  ```

- [ ] **Step 2: Generate migration**

  Run: `npm run db:generate`
  Expected: a new file `drizzle/0019_*.sql` and updated snapshot.

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/server/db/schema.ts drizzle/
  git commit -m "schema: add tables/columns for 10 missing traveler features"
  ```

---

## Task 2: Multi-currency expense conversion

**Files:**
- Modify: `src/lib/server/tripExpenses.ts`
- Modify: `src/routes/trips/[id]/+page.server.ts` (load)
- Modify: `src/routes/trips/[id]/+page.svelte` (expense form + totals)
- Modify: `src/routes/trips/[id]/edit/+page.server.ts` and `+page.svelte`
- Create: `src/lib/server/tripExpenses.test.ts` additions

- [ ] **Step 1: Update `addTripExpense` to accept and compute exchange rate**

  Add to interface and function:
  ```ts
  exchangeRate?: number; // scaled by 10000, default 10000
  ```
  Validate: `Number.isInteger(rate) && rate > 0 && rate <= 100000000`.
  Compute `baseAmount = Math.round((amount * rate) / 10000)`.

- [ ] **Step 2: Update `summarizeTripExpenses`**

  Return `totalsByBaseCurrency: Record<string, number>` from `baseAmount`.

- [ ] **Step 3: Add trip `baseCurrency` field to edit form and load**

  Edit form saves `trips.baseCurrency` (default 'USD', uppercase 3-letter).

- [ ] **Step 4: Tests**

  Test default rate, custom rate, and invalid rate.

---

## Task 3: Expense receipt attachments

**Files:**
- Create: `src/lib/server/tripExpenseAttachments.ts`
- Create: `src/lib/server/tripExpenseAttachments.test.ts`
- Create: `src/routes/trips/[id]/expenses/[expenseId]/attachments/[attachmentId]/+server.ts`
- Modify: `src/routes/trips/[id]/+page.server.ts`
- Modify: `src/routes/trips/[id]/+page.svelte`

- [ ] **Step 1: Implement upload and list helpers**

  ```ts
  const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR || (process.env.DATABASE_PATH ? path.join(path.dirname(process.env.DATABASE_PATH), 'attachments') : './data/attachments');
  const ALLOWED_TYPES = ['image/jpeg','image/png','image/webp','application/pdf'];
  const MAX_SIZE = 5 * 1024 * 1024;
  export function addAttachment(userId, expenseId, file: File) { ... }
  export function listAttachments(expenseId) { ... }
  export function deleteAttachment(userId, attachmentId) { ... }
  export function getAttachmentPath(attachment) { ... }
  ```

- [ ] **Step 2: Secure download endpoint**

  `GET /trips/:id/expenses/:expenseId/attachments/:attachmentId` verifies `requireEditableTrip` and streams the file.

- [ ] **Step 3: UI**

  Expense row shows attachment count; add upload/delete forms.

---

## Task 4: Saved trip templates

**Files:**
- Create: `src/lib/server/tripTemplates.ts`
- Create: `src/lib/server/tripTemplates.test.ts`
- Modify: `src/routes/trips/[id]/+page.server.ts`
- Modify: `src/routes/trips/[id]/+page.svelte`
- Modify: `src/routes/trips/new/+page.server.ts`
- Modify: `src/routes/trips/new/+page.svelte`

- [ ] **Step 1: Template module**

  ```ts
  export function saveTripTemplate(userId, sourceTripId, name) { ... }
  export function listTripTemplates(userId) { ... }
  export function createTripFromTemplate(userId, templateId, overrides: { name, startDate?, endDate? }) { ... }
  ```

- [ ] **Step 2: New-trip UI**

  Dropdown of templates; selecting one pre-fills name/destination/notes/tags.

- [ ] **Step 3: Tests**

  Save, list, create from template, and non-owner authorization.

---

## Task 5: Home-preparation task list

**Files:**
- Create: `src/lib/server/tripHomeTasks.ts`
- Create: `src/lib/server/tripHomeTasks.test.ts`
- Modify: `src/routes/trips/[id]/+page.server.ts`
- Modify: `src/routes/trips/[id]/+page.svelte`

- [ ] **Step 1: CRUD module**

  ```ts
  export function listHomeTasks(tripId) { ... }
  export function addHomeTask(userId, tripId, text, dueDate?) { ... }
  export function toggleHomeTask(userId, tripId, taskId) { ... }
  export function deleteHomeTask(userId, tripId, taskId) { ... }
  ```

- [ ] **Step 2: UI**

  New card with checkbox list, add form, and delete button.

---

## Task 6: Kid travel gear tracker

**Files:**
- Modify: `src/lib/server/tripCompanions.ts`
- Modify: `src/routes/trips/[id]/+page.svelte`
- Modify: `src/lib/server/tripCompanions.test.ts`

- [ ] **Step 1: Extend companion input and form validator**

  Accept booleans/strings for car seat, stroller, crib, kids meal, child ticket discount.

- [ ] **Step 2: UI**

  Show compact gear badges only when `category === 'child'`.

---

## Task 7: Companion seat/room/bedding preferences

**Files:**
- Modify: `src/lib/server/tripCompanions.ts`
- Modify: `src/routes/trips/[id]/+page.svelte`
- Modify: `src/lib/server/tripCompanions.test.ts`

- [ ] **Step 1: Extend companion input and validator**

  Accept `seatPreference` (enum), `bedPreference` (enum), `accessibilityNeeds`, `roomNotes`.

- [ ] **Step 2: UI**

  Add selects and text areas in companion form; display badges.

---

## Task 8: Medication / first-aid schedule

**Files:**
- Create: `src/lib/server/tripMedications.ts`
- Create: `src/lib/server/tripMedications.test.ts`
- Modify: `src/routes/trips/[id]/+page.server.ts`
- Modify: `src/routes/trips/[id]/+page.svelte`

- [ ] **Step 1: CRUD module**

  Validate optional `companionId` belongs to trip.

- [ ] **Step 2: UI**

  Card listing medications with companion name, dosage, schedule.

---

## Task 9: Visa / vaccination tracker

**Files:**
- Create: `src/lib/server/tripEntryRequirements.ts`
- Create: `src/lib/server/tripEntryRequirements.test.ts`
- Modify: `src/routes/trips/[id]/+page.server.ts`
- Modify: `src/routes/trips/[id]/+page.svelte`

- [ ] **Step 1: CRUD module**

  Enums: `requirementType` ∈ `{visa,vaccination,other}`, `status` ∈ `{needed,in_progress,complete,not_needed}`.

- [ ] **Step 2: UI**

  Table/list with country, type, status, due date.

---

## Task 10: Segment payment status

**Files:**
- Modify: `src/lib/server/segments.ts`
- Modify: `src/routes/trips/[id]/+page.svelte`
- Modify: `src/routes/trips/[id]/segments/+page.server.ts` if segment edit form is there
- Create: `src/routes/trips/[id]/segments/segments.test.ts` additions

- [ ] **Step 1: Update segment update/save functions**

  Accept `paymentStatus` and `paymentDueDate`; validate enum.

- [ ] **Step 2: UI**

  Inline edit form gets status select and due-date input; show badge on segment card.

---

## Task 11: Important-items registry

**Files:**
- Create: `src/lib/server/tripImportantItems.ts`
- Create: `src/lib/server/tripImportantItems.test.ts`
- Modify: `src/routes/trips/[id]/+page.server.ts`
- Modify: `src/routes/trips/[id]/+page.svelte`

- [ ] **Step 1: CRUD module**

  Optional companion link.

- [ ] **Step 2: UI**

  Card with name, serial, tracker ID, notes.

---

## Task 12: Wire trip-detail route

**Files:**
- Modify: `src/routes/trips/[id]/+page.server.ts`

- [ ] **Step 1: Import new modules**

  Import all new modules and load their data for owner/editor view.

- [ ] **Step 2: Add actions**

  Add actions for each feature (e.g. `addHomeTask`, `toggleHomeTask`, `deleteHomeTask`, `saveTripTemplate`, `createFromTemplate` is on new-trip page, `addMedication`, etc.).

---

## Task 13: Update trip-detail Svelte page

**Files:**
- Modify: `src/routes/trips/[id]/+page.svelte`

- [ ] **Step 1: Add UI sections**

  Add cards/sections for templates, home tasks, medications, entry requirements, important items, and attachment UI. Keep forms compact and editor-only.

---

## Task 14: Run verification

- [ ] **Step 1: Type check**

  Run: `npm run check`
  Expected: no Svelte/TypeScript errors.

- [ ] **Step 2: Tests**

  Run: `npm test`
  Expected: all tests pass.

- [ ] **Step 3: Build**

  Run: `DATABASE_PATH=./data/roamarr.db npm run build`
  Expected: production build succeeds.

---

## Task 15: Update docs

- [ ] **Step 1: Update README.md feature list**

  Add the ten new capabilities under the existing Features section.

- [ ] **Step 2: Update AGENTS.md**

  Keep under 40,000 characters; add new modules to Repository Map and Feature Surface.

---

## Task 16: Commit and push

- [ ] **Step 1: Commit changes**

  Group commits logically, e.g.:
  ```bash
  git add src/lib/server/db/schema.ts drizzle/
  git commit -m "schema: add tables/columns for 10 missing traveler features"
  git add src/lib/server/tripExpenses.ts ...
  git commit -m "feat: multi-currency expense conversion"
  ...
  ```

- [ ] **Step 2: Push**

  ```bash
  git push origin master
  ```

---

## Self-Review

- **Spec coverage:** every feature from the design spec has a task above.
- **Placeholder scan:** no TBD/TODO; all file paths and interfaces are concrete.
- **Type consistency:** `tripId` is always a number; `userId` from `requireUser(locals).id`; `companionId` optional and validated against the trip.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-25-roamarr-10-missing-features-plan.md`.

**Chosen execution option:** Subagent-Driven — dispatch focused subagents per task (or small groups of tasks) and review between tasks.
