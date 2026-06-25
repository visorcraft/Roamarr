# Roamarr Maintainability Improvements Design

## Goal
Identify and implement 10 high-impact, behavior-preserving improvements that make the Roamarr codebase more modular, robust, de-duplicated, and maintainable. No theme or visual-style changes.

## Approach
**Targeted modularization with shared primitives.** Introduce small, well-bounded helpers and factories where the same pattern is repeated across many files, split the most bloated modules, and extract shared UI/test utilities. Avoid a risky full rewrite.

## Selected Improvements

### 1. Trip-action wrapper helper
**Problem:** ~24 SvelteKit action handlers across 14 server modules repeat the same preamble:
```ts
const u = requireUser(event.locals);
const tripId = Number(event.params.id);
if (!Number.isFinite(tripId)) throw error(404, 'Not found');
const f = await event.request.formData();
// ... mutate ...
throw redirect(303, `/trips/${tripId}`);
```

**Solution:** Add `withTripAction(event)` in `src/lib/server/actions.ts` that returns `{ user, tripId, formData }`, validates the trip id, and lets callers redirect consistently.

**Impact:** ~80–100 lines removed; one place to change redirect/flash behavior.

### 2. Validation helpers
**Problem:** `Validator` success checks, entity-id parsing from form data, URL validation, and currency parsing are repeated with slight variations.

**Solution:** Extend `src/lib/server/validation.ts` with:
- `positiveIdFromForm(raw, field)`
- `httpUrl(raw, field)`
- `currency(raw, field)`
- `formFail(validator)` → `fail(400, { error, errors })`

**Impact:** ~60–80 lines removed; consistent validation error shapes.

### 3. Generic owned-row lookup
**Problem:** ~15 modules repeat:
```ts
const existing = db.select().from(table)
  .where(and(eq(table.id, id), eq(table.tripId, tripId))).get();
if (!existing) throw error(404, 'Not found');
```

**Solution:** Add `requireOwnedTripRow(table, tripId, id)` in `src/lib/server/ownership.ts`.

**Impact:** ~40–50 lines removed; consistent 404 behavior.

### 4. CRUD factory for simple trip-owned tables
**Problem:** `tripHomeTasks`, `tripImportantItems`, `tripMedications`, `tripEntryRequirements`, `tripDocumentLinks`, and `tripJournal` follow nearly identical list/add/update/delete/audit shapes.

**Solution:** Add `tripCrudFactory(table, options)` in `src/lib/server/crud.ts` for tables that only need standard CRUD + audit. Apply it to the simple trip-feature tables.

**Impact:** ~100–120 lines removed; new tables get CRUD actions almost for free.

### 5. Modularize `tripExpenses.ts`
**Problem:** `src/lib/server/tripExpenses.ts` (338 lines) mixes repository queries, multi-currency math, settlement logic, and form actions.

**Solution:** Split into:
- `tripExpenses/repository.ts`
- `tripExpenses/summaries.ts`
- `tripExpenses/actions.ts`
- `tripExpenses/types.ts`

**Impact:** Clear boundaries; easier testing and future changes.

### 6. Thin the trip-detail route
**Problem:** `src/routes/trips/[id]/+page.server.ts` is 561 lines: a 234-line `load` and ~47 inline action handlers spanning every subsystem.

**Solution:** Move load assembly to `src/lib/server/tripDetail.ts::buildTripDetail()` and re-export action handlers from existing/new server modules. Target route file under 150 lines.

**Impact:** Route layer becomes wiring only; business logic lives in server modules.

### 7. Shared test fixtures
**Problem:** Test files repeatedly inline user/trip/companion creation and several reinvent local factories.

**Solution:** Extend `tests/helpers.ts` with:
- `makeTrip(db, ownerId, overrides?)`
- `makeSegment(db, tripId, overrides?)`
- `makeCompanion(db, tripId, overrides?)`

Replace local factories in `tripJournal.test.ts`, `tripHomeTasks.test.ts`, `notifications.test.ts`, etc.

**Impact:** Less boilerplate; more readable tests.

### 8. Shared test event builders
**Problem:** Every route/server action test rebuilds its own SvelteKit `RequestEvent` stub.

**Solution:** Add `tests/eventHelpers.ts` with:
- `makePostEvent(user, params, body)`
- `makeFormEvent(user, params, record)`
- `makeLocals(user)`

**Impact:** ~30–50 lines of duplicated event builders removed.

### 9. Shared UI form-field components
**Problem:** Route pages repeat label + input/select/textarea + error markup dozens of times.

**Solution:** Create:
- `src/lib/components/FormField.svelte`
- `src/lib/components/SelectField.svelte`
- `src/lib/components/TextAreaField.svelte`

Each accepts `name`, `label`, `value`, `error`, and `disabled`.

**Impact:** Fewer inline class strings; consistent error wiring; easier theming.

### 10. Centralize constants
**Problem:** Hardcoded currency formatting, reminder offsets, status/visibility maps, and date formatting are scattered across pages.

**Solution:** Create:
- `src/lib/money.ts` – `formatCents(cents, currency)`
- `src/lib/reminderOffsets.ts` – offset options array
- `src/lib/segmentStatus.ts` – badge/label maps
- `src/lib/visibility.ts` – visibility meta
- Extend `src/lib/dateFormat.ts` with `formatDate` and `formatDateTime`

**Impact:** Single source of truth for common display logic.

## Non-Goals
- No new user-facing features.
- No theme or styling changes beyond extracting shared utilities.
- No database schema changes.
- No changes to auth/session/security invariants.

## Verification
- `rtk npm run check` passes with zero errors/warnings.
- `rtk npm test` passes (all existing tests).
- Behavior is preserved; only code organization and duplication are changed.
- Final commit pushed to `master`.
