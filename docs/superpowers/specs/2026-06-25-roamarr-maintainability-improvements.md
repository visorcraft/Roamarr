# Roamarr Maintainability Improvements

Date: 2026-06-25
Status: Design

## Objective

Implement 10 focused internal improvements that make the Roamarr codebase more modular, robust, and de-duplicated. No new user-facing features and no theme changes.

## Improvement Areas

### 1. Extend `tripCrudFactory` and migrate simple trip-owned modules

- Add `update(input, id)` and `listQuery(builder)` hooks to `src/lib/server/crud.ts`.
- Migrate `tripMedications.ts`, `tripImportantItems.ts`, and the read/update paths of `tripEntryRequirements.ts` to use the factory.
- Keep behavior identical; delete duplicated ownership/audit/validation boilerplate.

### 2. Centralize companion-on-trip validation

- Remove the local duplicate of `requireCompanionOnTrip` in `src/lib/server/tripChecklists.ts`.
- Replace manual `tripCompanions` lookups in `src/lib/server/tripExpenses/repository.ts` with the canonical helper from `src/lib/server/ownership.ts`.
- Add a batch variant `requireCompanionsOnTrip(ids, tripId)` if split-expense validation needs it.

### 3. Standardize trip-scoped actions with `withTripAction`

- Refactor action handlers that repeat `const tripId = Number(event.params.id); if (!Number.isFinite(tripId)) throw error(404, ...)` to use `withTripAction()`.
- Extend `withTripAction` to optionally enforce access level (`view` | `edit` | `own`) and centralize redirects where that removes duplication.
- Use `parseTripId()` for load functions.

### 4. Thin `src/routes/trips/[id]/+page.server.ts`

- Move inline action handlers for home tasks, medications, entry requirements, and important items into their respective `src/lib/server/` modules.
- Convert the route file into a thin registry:
  ```ts
  export const actions: Actions = {
    ...tripMetaActions,
    ...homeTaskActions,
    ...medicationActions,
    ...entryRequirementActions,
    ...importantItemActions
  };
  ```

### 5. Add `userCrudFactory` for user-owned tables

- Create a `userCrudFactory<TTable, Input>` in `src/lib/server/crud.ts` keyed on `userId` with optional audit logging.
- Apply to loyalty, insurance, cards, documents, notifications, and groups.
- Move `_`-prefixed route helpers into proper server modules (`cards.ts`, `insurance.ts`, `travelDocuments.ts`).

### 6. Standardize numeric ID validation

- Replace raw `Number(f.get('id'))` in routes with `positiveIdFromForm()` from `src/lib/server/validation.ts`.
- Add `positiveIdFromParams(name)` if route params need the same treatment.
- Prevent `NaN` IDs from reaching Drizzle queries.

### 7. Fix validation-error handling conventions

- Stop throwing `formFail()` (it returns a SvelteKit `Response`, not an `Error`). Update `src/lib/server/tripJournal.ts` domain helpers to return validation results or throw SvelteKit `error(400, ...)`; action handlers return `formFail(v)`.
- Replace plain `Error` throws in `src/lib/server/tripDocumentLinks.ts`, `tripComments.ts`, and `emergencyContacts.ts` with SvelteKit `error(400, ...)` or returned `fail()` payloads.

### 8. Centralize enum CHECK constraints in the schema

- Add `src/lib/server/db/schemaHelpers.ts` with an `enumCheck()` helper that accepts a column and a const array and generates the `check()` constraint (including nullable enum support).
- Define const arrays and derived types for every enum: segment types/statuses/payment statuses, travel document types, companion categories, seat/bed preferences, user roles, trip statuses/visibilities, share permissions, benefit types, reminder kinds/ref types/statuses, expense categories, watch statuses, entry-requirement types/statuses.
- Replace duplicated SQL CHECK strings in `src/lib/server/db/schema.ts` with `enumCheck()` calls while keeping column definitions inline.

### 9. Add missing DB indexes

- Add indexes on heavily queried foreign keys and lookup columns:
  - `fareProviders.userId`
  - `tripExpenseAttachments.expenseId`
  - `tripHomeTasks.tripId`
  - `tripMedications.tripId`, `tripMedications.companionId`
  - `tripImportantItems.tripId`, `tripImportantItems.companionId`
  - `fareWatches.tripId`, `fareWatches.segmentId`
  - `insurancePolicies.userId`
  - `sessions.userId`, `sessions.expiresAt`
  - `groups.ownerId`
  - `tripTemplates.userId`, `tripTemplates.sourceTripId`
- Run `npm run db:generate`, review the generated migration, and add a test migration if needed.

### 10. Extract shared test fixtures

- Add `resetTables(sqlite, ...tables)` to `tests/helpers.ts` to replace repeated raw `delete from ...` strings.
- Expand `tests/eventHelpers.ts` with `makeGetEvent`, `makePostEvent`, `makeFormEvent`, and `makeActionEvent` factories with consistent cookies and request shapes.
- Migrate the most repetitive server and route test files to use `resetTables` and the event factories.

## Verification

- `npm run check` passes with no Svelte/TypeScript errors.
- `npm test` passes with all existing tests green.
- `npm run build` produces a production build.
- `npm run db:generate` produces a reviewed migration for schema changes.

## Constraints

- No new themes or theme alterations.
- No new user-facing features.
- Existing behavior must remain unchanged.
- Prefer small, scoped edits that follow existing server/UI patterns.
