# Roamarr: 10 Missing Traveler Features — Design Spec

## Context

Roamarr is a self-hosted TripIt alternative in a v0.1 walking-skeleton state. The core architecture (SvelteKit + SQLite + Drizzle, hand-rolled sessions, in-process scheduler) is stable and many traveler/family features already exist: companions, packing checklists, expenses with split/settlement, polls, budgets, journal, document links, emergency-contact sharing, etc.

This spec adds ten shallow-but-useful features that families with kids, groups, and solo travelers commonly need. Each feature follows the existing pattern: schema change → server module → route action/load → small UI section → co-located tests. No new themes or visual overhauls.

## Selected Feature Batch (recommended balanced set)

1. **Multi-currency expense conversion** — record expenses in their original currency, store a manual exchange rate, and show normalized trip totals in a base currency.
2. **Expense receipt attachments** — upload receipt images/PDFs against an expense and serve them back securely.
3. **Saved trip templates** — save an existing trip as a reusable template and create new trips from it.
4. **Home-preparation task list** — per-trip pre-departure / while-away checklist (mail hold, thermostat, plants, etc.) with due dates.
5. **Kid travel gear tracker** — per-companion flags for car seat, stroller, crib/rollaway, kids meal, and child-ticket discount.
6. **Companion seat/room/bedding preferences** — seat preference, bed type, accessibility needs, and room notes per companion.
7. **Medication / first-aid schedule** — per-trip medications with dosage, schedule, and notes; optionally linked to a companion.
8. **Visa / vaccination tracker** — per-trip entry requirements by country with type, status, due date, and notes.
9. **Segment payment status** — mark segments as quoted, deposit-paid, fully-paid, or refunded with payment due dates.
10. **Important-items registry** — per-trip registry of valuables with serial numbers, tracker IDs, and notes.

## Non-goals

- Live exchange-rate fetching, flight status, weather, maps, OCR, web-push, or offline service workers. These are useful but rely on third-party APIs or large new infrastructure and are out of scope for this batch.
- Changing themes, colors, or the global navigation shell.
- Deep social features such as group chat or real-time collaboration.

## Architecture

All features are server-side first:

- **Schema**: edit `src/lib/server/db/schema.ts`, run `npm run db:generate`, review generated SQL.
- **Server modules**: add `src/lib/server/<feature>.ts` for each domain; keep business logic out of routes.
- **Routes**: wire load/actions into existing `src/routes/trips/[id]/+page.server.ts` and add minimal forms to `+page.svelte`. New trip creation changes live in `src/routes/trips/new/+page.server.ts` and `+page.svelte`.
- **Authorization**: reuse `requireEditableTrip`, `requireOwnedTrip`, and `sharing.canView`. Mutations log via `logAudit`.
- **Tests**: co-located `.test.ts` for server modules and route tests where mutations are non-trivial.

## Feature Designs

### 1. Multi-currency expense conversion

**Goal**: let group travelers record expenses in the currency they were actually charged in, while still seeing a single normalized total.

**Schema changes**:
- `trips.baseCurrency text not null default 'USD'`
- `trip_expenses.exchangeRate integer not null default 10000` (rate scaled by 10,000, e.g. 0.92 EUR/USD stored as 9200)
- `trip_expenses.baseAmount integer not null default 0` (computed: `amount * exchangeRate / 10000`)

**Behavior**:
- `addTripExpense` accepts optional `baseCurrency` on the trip and `exchangeRate` on the expense. If omitted, default to 1.0 (10,000) and the trip's base currency.
- `baseAmount` is computed server-side and stored so summaries are fast.
- `summarizeTripExpenses` returns a new `totalsByBaseCurrency` record in addition to the existing raw totals.
- Existing expenses without a rate are treated as 1.0 in the trip's base currency.

**UI**: add `Base currency` to the trip edit form and a small `Rate` input on the expense form. Show normalized total next to raw totals.

**Tests**: conversion math, defaulting, and validation of invalid rates.

### 2. Expense receipt attachments

**Goal**: attach a photo or PDF of a receipt to an expense.

**Schema changes**:
- `trip_expense_attachments` table: `id`, `expenseId` FK cascade, `filename`, `storageKey`, `contentType`, `sizeBytes`, `createdAt`.

**Behavior**:
- Files are written to `{ATTACHMENTS_DIR}/{userId}/{expenseId}/{random-uuid}-{filename}` where `ATTACHMENTS_DIR` defaults to `{cwd}/data/attachments` (or `/data/attachments` in containers).
- Max file size 5 MB; allowed content types limited to common image/PDF MIME types.
- A new route `src/routes/trips/[id]/expenses/[expenseId]/attachments/[attachmentId]/+server.ts` streams the file to authorized users only.
- Deleting an expense cascades attachments; deleting a single attachment removes the file.

**UI**: on each expense row, show paperclip icon + attachment count; expand to list downloads and an upload form.

**Tests**: upload, download authorization, content-type validation, and cleanup on delete.

### 3. Saved trip templates

**Goal**: reuse common trip shapes (weekend family trip, annual group ski trip, etc.).

**Schema changes**:
- `trip_templates` table: `id`, `userId` FK cascade, `name`, `sourceTripId` FK set-null, `snapshotJson text`, `createdAt`.
- Snapshot JSON stores the trip name, destination, notes, tags, and a shallow list of segments (title, type, location). It intentionally does not copy dates or companion-specific data.

**Behavior**:
- `saveTripTemplate(userId, sourceTripId, name)` copies the source trip's public fields into `snapshotJson` and stores it under the user's account.
- `listTripTemplates(userId)` returns the user's templates.
- `createTripFromTemplate(userId, templateId, overrides)` creates a new trip with the snapshot's name/destination/notes/tags; overrides (name, startDate, endDate) come from the new-trip form.

**UI**: trip detail gets a "Save as template" form; the new-trip page gets a "Start from template" selector that pre-fills fields.

**Tests**: save, list, create from template, and authorization.

### 4. Home-preparation task list

**Goal**: capture pre-departure and while-away tasks such as holding mail, adjusting the thermostat, watering plants, or notifying a house-sitter.

**Schema changes**:
- `trip_home_tasks` table: `id`, `tripId` FK cascade, `text`, `dueDate`, `done`, `sortOrder`, `createdAt`.

**Behavior**:
- CRUD via `tripHomeTasks.ts`: add, toggle, delete, reorder (optional).
- Tasks are visible to anyone who can view the trip; only editors can mutate.
- Overdue, undone tasks are surfaced lightly on the dashboard (optional shallow version: just a count on the trip detail).

**UI**: new card on trip detail titled "Home prep" with checkbox list and add form.

**Tests**: CRUD, authorization, and companion-agnostic visibility.

### 5. Kid travel gear tracker

**Goal**: remember child-specific travel gear and meal needs.

**Schema changes**:
- Add columns to `trip_companions`:
  - `needsCarSeat integer default false`
  - `needsStroller integer default false`
  - `needsCrib integer default false`
  - `needsKidsMeal integer default false`
  - `childTicketDiscount integer default false` (or text nullable)

**Behavior**:
- Only shown/edited in the companion form when `category === 'child'`; stored as booleans/nullable notes.
- `listTripCompanions` returns them; the UI renders compact gear badges.

**Tests**: update child gear flags and ensure adult companions ignore them.

### 6. Companion seat/room/bedding preferences

**Goal**: record seating, bedding, and accessibility preferences per traveler for booking coordination.

**Schema changes**:
- Add columns to `trip_companions`:
  - `seatPreference text` (check: `'aisle'|'window'|'middle'|'none'`)
  - `bedPreference text` (check: `'king'|'queen'|'twin'|'two_doubles'|'other'`)
  - `accessibilityNeeds text`
  - `roomNotes text`

**Behavior**:
- Companion form exposes select inputs for seat/bed preference and text areas for accessibility/room notes.
- Visible to editors; for shared viewers, suppress private notes (already done for `dietary/allergies/medicalNotes`).

**Tests**: validation of enum values and privacy filtering.

### 7. Medication / first-aid schedule

**Goal**: track prescriptions and basic first-aid info, especially for family trips.

**Schema changes**:
- `trip_medications` table: `id`, `tripId` FK cascade, `companionId` FK set-null, `name`, `dosage`, `schedule`, `startsAt`, `endsAt`, `notes`, `createdAt`, `updatedAt`.

**Behavior**:
- CRUD module `tripMedications.ts`. `companionId` optional; if set, validate companion belongs to the trip.
- Visible to trip viewers; editable only by editors.

**UI**: card on trip detail with medication list and add form.

**Tests**: CRUD, companion validation, and authorization.

### 8. Visa / vaccination tracker

**Goal**: track entry requirements and vaccination deadlines per destination.

**Schema changes**:
- `trip_entry_requirements` table: `id`, `tripId` FK cascade, `country`, `requirementType` (check: `'visa'|'vaccination'|'other'`), `status` (check: `'needed'|'in_progress'|'complete'|'not_needed'`), `dueDate`, `notes`, `createdAt`, `updatedAt`.

**Behavior**:
- CRUD module `tripEntryRequirements.ts`.
- Default status `needed`. Show count of incomplete requirements on trip detail.

**UI**: card on trip detail with table/list and status dropdown.

**Tests**: CRUD, status enum validation, and visibility.

### 9. Segment payment status

**Goal**: know whether a segment reservation is quoted, deposit-paid, fully-paid, or refunded and when the next payment is due.

**Schema changes**:
- Add to `segments`:
  - `paymentStatus text` (check: `'quoted'|'deposit_paid'|'fully_paid'|'refunded'`) default `'quoted'`
  - `paymentDueDate text` nullable

**Behavior**:
- Inline edit form on the trip detail already exposes segment fields; add payment status select and due-date input.
- `segments.ts` update function accepts the new fields.
- Optional: dashboard flag for upcoming payment due dates within 7 days.

**Tests**: update payment status, enum validation, and dashboard query if implemented.

### 10. Important-items registry

**Goal**: a lightweight lost-and-found / valuables registry with serial numbers and tracker IDs.

**Schema changes**:
- `trip_important_items` table: `id`, `tripId` FK cascade, `companionId` FK set-null, `name`, `serialNumber`, `trackerId`, `notes`, `createdAt`, `updatedAt`.

**Behavior**:
- CRUD module `tripImportantItems.ts`.
- Companion link optional and validated.

**UI**: card on trip detail with list and add form.

**Tests**: CRUD, companion validation, authorization.

## Common UI/UX Conventions

- Each new card on `/trips/[id]` uses the existing `card p-5` and `section-title` classes.
- Editor-only forms are hidden from shared viewers.
- Compact inline forms use `input`, `select`, `btn btn-primary btn-sm`, and `icon-button` for deletes.
- Keep new UI dense; avoid heroes, one-off palettes, or viewport-scaled text.

## Security and Privacy

- All file uploads are restricted by MIME type and size; downloads require the same trip authorization as the parent expense.
- Companion medical/gear/accessibility notes are suppressed for shared viewers (extend the existing redaction in `+page.server.ts`).
- All mutations call `logAudit` and use existing ownership/sharing helpers.
- Public share/calendar projections continue to exclude private notes and new sensitive fields.

## Testing Strategy

- Co-located server tests for each new module (`tripExpenseAttachments.test.ts`, `tripTemplates.test.ts`, `tripHomeTasks.test.ts`, `tripMedications.test.ts`, `tripEntryRequirements.test.ts`, `tripImportantItems.test.ts`).
- Add/update route tests for trip-detail actions and the new-trip page template flow.
- Run `npm run check` and `npm test` before committing.

## Migration Strategy

- Make all schema changes in `src/lib/server/db/schema.ts`.
- Run `npm run db:generate` once after all changes to produce a single migration file.
- Review the generated SQL in `drizzle/` for sensible defaults and FK indexes.

## Acceptance Criteria

- All ten features are visible and functional for trip editors.
- Shared viewers see appropriate public subsets.
- `npm run check` passes.
- `npm test` passes.
- `npm run build` succeeds (with `DATABASE_PATH=./data/roamarr.db` in this environment).
- All changes are committed and pushed to `master`.
