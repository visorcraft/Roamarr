# Roamarr Maintainability Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 10 behavior-preserving improvements that reduce duplication and increase modularity across Roamarr's server modules, route files, tests, and UI components.

**Architecture:** Introduce small shared helpers/factories in `src/lib/server/` (`actions.ts`, `validation.ts`, `ownership.ts`, `crud.ts`), split the most bloated modules (`tripExpenses.ts`, trip-detail route), extract shared test utilities, and create reusable Svelte form-field components plus centralized display constants.

**Tech Stack:** SvelteKit 2 / Svelte 5, TypeScript, Drizzle ORM, SQLite, Vitest, Tailwind CSS v4.

---

## File Structure

### New shared server helpers
- `src/lib/server/actions.ts` — trip-action wrapper helper.
- `src/lib/server/crud.ts` — generic CRUD factory for simple trip-owned tables.
- `src/lib/server/tripExpenses/repository.ts`
- `src/lib/server/tripExpenses/summaries.ts`
- `src/lib/server/tripExpenses/actions.ts`
- `src/lib/server/tripExpenses/types.ts`
- `src/lib/server/tripDetail.ts` — `buildTripDetail()` load assembly.

### Modified server helpers
- `src/lib/server/validation.ts` — add `positiveIdFromForm`, `httpUrl`, `currency`, `formFail`.
- `src/lib/server/ownership.ts` — add `requireOwnedTripRow`.
- `src/lib/server/tripExpenses.ts` — re-export from new directory, then delete.

### Modified route files
- `src/routes/trips/[id]/+page.server.ts` — thin to wiring only.
- `src/routes/trips/[id]/+page.svelte` — use new components/constants where touched.

### New shared test utilities
- `tests/eventHelpers.ts`

### Modified test helpers
- `tests/helpers.ts` — add `makeTrip`, `makeSegment`, `makeCompanion`.

### New shared UI components
- `src/lib/components/FormField.svelte`
- `src/lib/components/SelectField.svelte`
- `src/lib/components/TextAreaField.svelte`

### New shared display utilities
- `src/lib/money.ts`
- `src/lib/reminderOffsets.ts`
- `src/lib/segmentStatus.ts`
- `src/lib/visibility.ts`
- `src/lib/dateFormat.ts` — extend.

---

## Task 1: Extend validation helpers

**Files:**
- Modify: `src/lib/server/validation.ts`
- Test: `src/lib/server/validation.test.ts`

- [ ] **Step 1: Add tests for new helpers**

```ts
// src/lib/server/validation.test.ts
import { describe, it, expect } from 'vitest';
import * as v from './validation';

describe('positiveIdFromForm', () => {
	it('parses positive integer', () => {
		const result = v.positiveIdFromForm('42', 'id');
		expect(result).toEqual({ ok: true, value: 42 });
	});
	it('rejects non-numeric', () => {
		const result = v.positiveIdFromForm('abc', 'id');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('id');
	});
	it('rejects zero', () => {
		const result = v.positiveIdFromForm('0', 'id');
		expect(result.ok).toBe(false);
	});
});

describe('httpUrl', () => {
	it('accepts https url', () => {
		const result = v.httpUrl('https://example.com', 'url');
		expect(result).toEqual({ ok: true, value: 'https://example.com' });
	});
	it('rejects missing scheme', () => {
		const result = v.httpUrl('example.com', 'url');
		expect(result.ok).toBe(false);
	});
});

describe('currency', () => {
	it('accepts USD', () => {
		const result = v.currency('USD', 'currency');
		expect(result).toEqual({ ok: true, value: 'USD' });
	});
	it('rejects lowercase', () => {
		const result = v.currency('usd', 'currency');
		expect(result.ok).toBe(false);
	});
});

describe('formFail', () => {
	it('returns fail payload', () => {
		const validator = new v.Validator();
		validator.addError('name', 'required');
		const result = v.formFail(validator);
		expect(result.status).toBe(400);
		expect(result.data).toMatchObject({ error: 'name: required', errors: { name: 'required' } });
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk npx vitest run src/lib/server/validation.test.ts`
Expected: FAIL — functions not found.

- [ ] **Step 3: Implement helpers**

Add to `src/lib/server/validation.ts`:

```ts
import { fail } from '@sveltejs/kit';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function positiveIdFromForm(raw: FormDataEntryValue | null, field: string): Result<number> {
	const str = String(raw ?? '').trim();
	const n = Number(str);
	if (!str || !Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
		return { ok: false, error: `${field} must be a positive integer` };
	}
	return { ok: true, value: n };
}

export function httpUrl(raw: FormDataEntryValue | null, field: string): Result<string> {
	const str = String(raw ?? '').trim();
	try {
		const url = new URL(str);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return { ok: false, error: `${field} must be an http or https URL` };
		}
		return { ok: true, value: str };
	} catch {
		return { ok: false, error: `${field} must be a valid URL` };
	}
}

export function currency(raw: FormDataEntryValue | null, field: string): Result<string> {
	const str = String(raw ?? '').trim().toUpperCase();
	if (!/^[A-Z]{3}$/.test(str)) {
		return { ok: false, error: `${field} must be a 3-letter currency code` };
	}
	return { ok: true, value: str };
}

export function formFail(validator: Validator) {
	return fail(400, { error: validator.failMessage(), errors: validator.errors });
}
```

- [ ] **Step 4: Run tests**

Run: `rtk npx vitest run src/lib/server/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/validation.ts src/lib/server/validation.test.ts
git commit -m "feat(validation): add positiveIdFromForm, httpUrl, currency, formFail helpers"
```

---

## Task 2: Generic owned-row lookup

**Files:**
- Modify: `src/lib/server/ownership.ts`
- Test: `src/lib/server/ownership.test.ts`

- [ ] **Step 1: Add tests**

```ts
// src/lib/server/ownership.test.ts (append)
import { eq, and } from 'drizzle-orm';
import { db } from './db';
import { trips, tripHomeTasks } from './db/schema';
import { makeUser, makeTrip } from '../../../tests/helpers';

describe('requireOwnedTripRow', () => {
	it('returns row when owned by trip', async () => {
		const u = makeUser();
		const trip = makeTrip({ ownerId: u.id });
		const inserted = db.insert(tripHomeTasks).values({ tripId: trip.id, task: 'A' }).returning().get();
		const found = requireOwnedTripRow(tripHomeTasks, trip.id, inserted.id);
		expect(found.id).toBe(inserted.id);
	});
	it('throws 404 when row belongs to another trip', async () => {
		const u = makeUser();
		const t1 = makeTrip({ ownerId: u.id });
		const t2 = makeTrip({ ownerId: u.id });
		const inserted = db.insert(tripHomeTasks).values({ tripId: t1.id, task: 'A' }).returning().get();
		expect(() => requireOwnedTripRow(tripHomeTasks, t2.id, inserted.id)).toThrow();
	});
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `rtk npx vitest run src/lib/server/ownership.test.ts`
Expected: FAIL — `requireOwnedTripRow` not defined.

- [ ] **Step 3: Implement helper**

Add to `src/lib/server/ownership.ts`:

```ts
import { eq, and } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core';
import { db } from './db';

export function requireOwnedTripRow<T extends SQLiteTableWithColumns<any>>(
	table: T,
	tripId: number,
	id: number,
	notFoundMessage = 'Not found'
): T['$inferSelect'] {
	const row = db
		.select()
		.from(table)
		.where(and(eq(table.id, id), eq(table.tripId, tripId)))
		.get();
	if (!row) throw error(404, notFoundMessage);
	return row;
}
```

- [ ] **Step 4: Run tests**

Run: `rtk npx vitest run src/lib/server/ownership.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/ownership.ts src/lib/server/ownership.test.ts
git commit -m "feat(ownership): add requireOwnedTripRow helper"
```

---

## Task 3: Trip-action wrapper helper

**Files:**
- Create: `src/lib/server/actions.ts`
- Test: `src/lib/server/actions.test.ts`

- [ ] **Step 1: Write tests**

```ts
// src/lib/server/actions.test.ts
import { describe, it, expect, vi } from 'vitest';
import { withTripAction } from './actions';
import type { RequestEvent } from '@sveltejs/kit';

describe('withTripAction', () => {
	function makeEvent(params: Record<string, string>, body: Record<string, string>) {
		const form = new FormData();
		for (const [k, v] of Object.entries(body)) form.append(k, v);
		return {
			locals: { user: { id: 1, email: 'a@b.com' } },
			params,
			request: { formData: async () => form }
		} as unknown as RequestEvent;
	}

	it('returns user, tripId and formData', async () => {
		const event = makeEvent({ id: '5' }, { name: 'x' });
		const result = await withTripAction(event);
		expect(result.user.id).toBe(1);
		expect(result.tripId).toBe(5);
		expect(result.formData.get('name')).toBe('x');
	});

	it('throws 404 for invalid trip id', async () => {
		const event = makeEvent({ id: 'abc' }, {});
		await expect(withTripAction(event)).rejects.toMatchObject({ status: 404 });
	});
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `rtk npx vitest run src/lib/server/actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement helper**

```ts
// src/lib/server/actions.ts
import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from './auth';

export async function withTripAction(event: RequestEvent) {
	const user = requireUser(event.locals);
	const tripId = Number(event.params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');
	const formData = await event.request.formData();
	return { user, tripId, formData };
}
```

- [ ] **Step 4: Run tests**

Run: `rtk npx vitest run src/lib/server/actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/actions.ts src/lib/server/actions.test.ts
git commit -m "feat(actions): add withTripAction wrapper helper"
```

---

## Task 4: Apply helpers to simple trip-feature modules

**Files:**
- Modify: `src/lib/server/tripHomeTasks.ts`, `src/lib/server/tripImportantItems.ts`, `src/lib/server/tripMedications.ts`, `src/lib/server/tripEntryRequirements.ts`, `src/lib/server/tripDocumentLinks.ts`, `src/lib/server/tripJournal.ts`
- Tests: corresponding `.test.ts` files

- [ ] **Step 1: Refactor `tripHomeTasks.ts`**

Replace preamble and owned-row lookups with new helpers. Example diff:

```ts
import { withTripAction } from './actions';
import { positiveIdFromForm, formFail } from './validation';
import { requireOwnedTripRow } from './ownership';

export async function addHomeTaskAction(event) {
	const { user, tripId, formData } = await withTripAction(event);
	const task = String(formData.get('task') ?? '').trim();
	if (!task) return fail(400, { error: 'Task is required' });
	const id = addTripHomeTask(user.id, tripId, task);
	throw redirect(303, `/trips/${tripId}`);
}

export async function deleteHomeTaskAction(event) {
	const { user, tripId, formData } = await withTripAction(event);
	const idResult = positiveIdFromForm(formData.get('taskId'), 'taskId');
	if (!idResult.ok) return fail(400, { error: idResult.error });
	requireOwnedTripRow(tripHomeTasks, tripId, idResult.value);
	deleteTripHomeTask(user.id, idResult.value);
	throw redirect(303, `/trips/${tripId}`);
}
```

- [ ] **Step 2: Refactor `tripImportantItems.ts`, `tripMedications.ts`, `tripEntryRequirements.ts`, `tripDocumentLinks.ts`, `tripJournal.ts` similarly**

Apply the same pattern: `withTripAction` for preamble, `positiveIdFromForm` for ids, `requireOwnedTripRow` for lookups, `formFail` for validator failures.

- [ ] **Step 3: Run affected tests**

Run: `rtk npx vitest run src/lib/server/tripHomeTasks.test.ts src/lib/server/tripImportantItems.test.ts src/lib/server/tripMedications.test.ts src/lib/server/tripEntryRequirements.test.ts src/lib/server/tripDocumentLinks.test.ts src/lib/server/tripJournal.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/tripHomeTasks.ts src/lib/server/tripImportantItems.ts src/lib/server/tripMedications.ts src/lib/server/tripEntryRequirements.ts src/lib/server/tripDocumentLinks.ts src/lib/server/tripJournal.ts
git commit -m "refactor: use shared action/validation/ownership helpers in simple trip modules"
```

---

## Task 5: CRUD factory for simple trip-owned tables

**Files:**
- Create: `src/lib/server/crud.ts`
- Test: `src/lib/server/crud.test.ts`
- Modify: apply to at least `tripHomeTasks.ts`

- [ ] **Step 1: Design factory signature**

```ts
// src/lib/server/crud.ts
import { eq } from 'drizzle-orm';
import { db } from './db';
import { logAudit } from './audit';
import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core';

export interface TripCrudOptions<T extends SQLiteTableWithColumns<any>, Input> {
	table: T;
	auditEntity: string;
	orderBy?: keyof T['$inferSelect'];
	insert: (input: Input, tripId: number) => T['$inferInsert'];
	update?: (input: Input) => Partial<T['$inferInsert']>;
	validate: (input: Input) => { ok: false; error: string } | { ok: true };
}

export function tripCrudFactory<T extends SQLiteTableWithColumns<any>, Input>(options: TripCrudOptions<T, Input>) {
	const { table, auditEntity, orderBy = 'createdAt' as keyof T['$inferSelect'], insert, update, validate } = options;

	function list(tripId: number): T['$inferSelect'][] {
		return db.select().from(table).where(eq(table.tripId, tripId)).orderBy(table[orderBy]).all();
	}

	function add(userId: number, tripId: number, input: Input): number {
		const v = validate(input);
		if (!v.ok) throw new Error(v.error);
		const inserted = db.insert(table).values(insert(input, tripId) as any).returning().get();
		logAudit(userId, 'create', auditEntity, inserted.id, { tripId });
		return inserted.id;
	}

	function patch(userId: number, tripId: number, id: number, input: Input): void {
		if (!update) throw new Error('Update not supported');
		const v = validate(input);
		if (!v.ok) throw new Error(v.error);
		db.update(table).set(update(input) as any).where(and(eq(table.id, id), eq(table.tripId, tripId))).run();
		logAudit(userId, 'update', auditEntity, id, { tripId });
	}

	function remove(userId: number, tripId: number, id: number): void {
		db.delete(table).where(and(eq(table.id, id), eq(table.tripId, tripId))).run();
		logAudit(userId, 'delete', auditEntity, id, { tripId });
	}

	return { list, add, patch, remove };
}
```

- [ ] **Step 2: Write tests**

```ts
// src/lib/server/crud.test.ts
import { describe, it, expect } from 'vitest';
import { tripCrudFactory } from './crud';
import { db } from './db';
import { tripHomeTasks } from './db/schema';
import { makeUser, makeTrip } from '../../tests/helpers';

describe('tripCrudFactory', () => {
	const crud = tripCrudFactory({
		table: tripHomeTasks,
		auditEntity: 'home_task',
		insert: (task: string, tripId) => ({ tripId, task }),
		validate: (task) => (task.trim() ? { ok: true } : { ok: false, error: 'required' })
	});

	it('lists by trip', () => {
		const u = makeUser();
		const t = makeTrip({ ownerId: u.id });
		crud.add(u.id, t.id, 'Pack');
		expect(crud.list(t.id)).toHaveLength(1);
	});

	it('adds and returns id', () => {
		const u = makeUser();
		const t = makeTrip({ ownerId: u.id });
		const id = crud.add(u.id, t.id, 'Pack');
		expect(typeof id).toBe('number');
	});

	it('removes owned row', () => {
		const u = makeUser();
		const t = makeTrip({ ownerId: u.id });
		const id = crud.add(u.id, t.id, 'Pack');
		crud.remove(u.id, t.id, id);
		expect(crud.list(t.id)).toHaveLength(0);
	});
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `rtk npx vitest run src/lib/server/crud.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement factory and run tests**

Create `src/lib/server/crud.ts` and run tests.
Expected: PASS.

- [ ] **Step 5: Apply factory to `tripHomeTasks.ts`**

Refactor `tripHomeTasks.ts` to use the factory internally while keeping the same exported API. Ensure existing tests pass.

- [ ] **Step 6: Run tests**

Run: `rtk npx vitest run src/lib/server/crud.test.ts src/lib/server/tripHomeTasks.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/crud.ts src/lib/server/crud.test.ts src/lib/server/tripHomeTasks.ts
git commit -m "feat(crud): add tripCrudFactory and apply to home tasks"
```

---

## Task 6: Modularize tripExpenses.ts

**Files:**
- Create: `src/lib/server/tripExpenses/repository.ts`, `summaries.ts`, `actions.ts`, `types.ts`
- Modify: `src/lib/server/tripExpenses.ts` (re-exports, then delete)
- Test: `src/lib/server/tripExpenses.test.ts`

- [ ] **Step 1: Create types file**

```ts
// src/lib/server/tripExpenses/types.ts
export interface TripExpenseSummary {
	totalCents: number;
	byCurrency: Record<string, number>;
	byCategory: Record<string, number>;
}

export interface Settlement {
	from: number;
	to: number;
	amountCents: number;
}
```

- [ ] **Step 2: Create repository file**

Move `listTripExpenses`, `addTripExpense`, `deleteTripExpense` and DB-only helpers into `src/lib/server/tripExpenses/repository.ts`.

- [ ] **Step 3: Create summaries file**

Move `summarizeTripExpenses` and `computeSettlement` into `src/lib/server/tripExpenses/summaries.ts`.

- [ ] **Step 4: Create actions file**

Move `addExpense` and `deleteExpense` form handlers into `src/lib/server/tripExpenses/actions.ts`.

- [ ] **Step 5: Update re-exports**

Replace `src/lib/server/tripExpenses.ts` contents with:

```ts
export * from './tripExpenses/repository';
export * from './tripExpenses/summaries';
export * from './tripExpenses/actions';
export * from './tripExpenses/types';
```

- [ ] **Step 6: Run tests**

Run: `rtk npx vitest run src/lib/server/tripExpenses.test.ts`
Expected: PASS — existing tests should still work because public API is unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/tripExpenses/
git commit -m "refactor(tripExpenses): split into repository, summaries, actions, types"
```

---

## Task 7: Thin trip-detail route

**Files:**
- Create: `src/lib/server/tripDetail.ts`
- Modify: `src/routes/trips/[id]/+page.server.ts`

- [ ] **Step 1: Extract load assembly**

Create `src/lib/server/tripDetail.ts`:

```ts
import { error } from '@sveltejs/kit';
import { requireEditableTrip, requireViewableTrip, canEdit } from './ownership';
import { listTripCompanions } from './tripCompanions';
import { listTripExpenses, summarizeTripExpenses } from './tripExpenses';
// ... other imports

export async function buildTripDetail(user: User, tripId: number, url: URL) {
	const view = requireViewableTrip(user.id, tripId);
	const editor = canEdit(user.id, tripId);
	// ... assemble all data the same way +page.server.ts load does
	return {
		view,
		editor,
		companions: listTripCompanions(tripId),
		expenses: listTripExpenses(tripId),
		summary: summarizeTripExpenses(tripId),
		// ... etc
	};
}
```

- [ ] **Step 2: Refactor route load**

Update `src/routes/trips/[id]/+page.server.ts`:

```ts
import { buildTripDetail } from '$lib/server/tripDetail';

export const load = async ({ locals, params, url }) => {
	const user = requireUser(locals);
	const tripId = parseTripId(params);
	return await buildTripDetail(user, tripId, url);
};
```

- [ ] **Step 3: Move action handlers to server modules**

For each inline action in the route file, either:
- Re-export from an existing server module (e.g., `tripHomeTasks.ts`, `tripExpenses.ts`).
- Or create a small server module for grouped actions (e.g., `src/lib/server/tripMetaActions.ts` for archive/favorite/duplicate/regenerate/revoke).

Example:

```ts
// src/lib/server/tripMetaActions.ts
import { withTripAction } from './actions';

export async function archiveTripAction(event) {
	const { user, tripId } = await withTripAction(event);
	await archiveTrip(user.id, tripId);
	throw redirect(303, `/trips/${tripId}`);
}
```

- [ ] **Step 4: Wire re-exports in route actions**

Update `src/routes/trips/[id]/+page.server.ts` actions to re-export:

```ts
export const actions = {
	archiveTrip: tripMetaActions.archiveTripAction,
	favoriteTrip: tripMetaActions.favoriteTripAction,
	addHomeTask: tripHomeTasks.addHomeTaskAction,
	// ... etc
};
```

- [ ] **Step 5: Run route tests**

Run: `rtk npx vitest run src/routes/trips/trips.test.ts src/routes/trips/[id]/trip-detail.test.ts src/routes/trips/segments.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/tripDetail.ts src/lib/server/tripMetaActions.ts src/routes/trips/[id]/+page.server.ts
git commit -m "refactor(routes): thin trip-detail route with server modules"
```

---

## Task 8: Shared test fixtures

**Files:**
- Modify: `tests/helpers.ts`

- [ ] **Step 1: Add fixture helpers**

```ts
// tests/helpers.ts
import { db } from '../src/lib/server/db';
import { users, trips, segments, tripCompanions } from '../src/lib/server/db/schema';

export function makeTrip(overrides: Partial<typeof trips.$inferInsert> = {}) {
	return db
		.insert(trips)
		.values({
			name: 'Test Trip',
			ownerId: 0,
			visibility: 'private',
			...overrides
		})
		.returning()
		.get();
}

export function makeSegment(overrides: Partial<typeof segments.$inferInsert> = {}) {
	return db
		.insert(segments)
		.values({
			tripId: 0,
			type: 'flight',
			status: 'planned',
			startAt: new Date().toISOString(),
			...overrides
		})
		.returning()
		.get();
}

export function makeCompanion(overrides: Partial<typeof tripCompanions.$inferInsert> = {}) {
	return db
		.insert(tripCompanions)
		.values({
			tripId: 0,
			name: 'Companion',
			...overrides
		})
		.returning()
		.get();
}
```

- [ ] **Step 2: Migrate one test file**

Update `src/lib/server/tripHomeTasks.test.ts` to use `makeTrip(makeUser())` and remove its local seed helper.

- [ ] **Step 3: Run tests**

Run: `rtk npx vitest run src/lib/server/tripHomeTasks.test.ts`
Expected: PASS.

- [ ] **Step 4: Migrate additional test files**

Repeat for `tripJournal.test.ts`, `tripCompanions.test.ts`, `tripExpenses.test.ts`, `notifications.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers.ts src/lib/server/tripHomeTasks.test.ts src/lib/server/tripJournal.test.ts
git commit -m "test(helpers): add makeTrip/makeSegment/makeCompanion fixtures and migrate tests"
```

---

## Task 9: Shared test event builders

**Files:**
- Create: `tests/eventHelpers.ts`

- [ ] **Step 1: Create builders**

```ts
// tests/eventHelpers.ts
import type { RequestEvent } from '@sveltejs/kit';

export function makeLocals(user: { id: number; email: string }) {
	return { user };
}

export function makePostEvent(
	user: { id: number; email: string },
	params: Record<string, string>,
	body: URLSearchParams | FormData,
	url = 'http://localhost/'
): RequestEvent {
	return {
		locals: makeLocals(user),
		params,
		request: {
			formData: async () =>
				body instanceof URLSearchParams ? paramsToFormData(body) : body,
			method: 'POST'
		},
		url: new URL(url),
		cookies: {}
	} as unknown as RequestEvent;
}

export function makeFormEvent(
	user: { id: number; email: string },
	params: Record<string, string>,
	record: Record<string, string>,
	url = 'http://localhost/'
): RequestEvent {
	const form = new FormData();
	for (const [k, v] of Object.entries(record)) form.append(k, v);
	return makePostEvent(user, params, form, url);
}

function paramsToFormData(params: URLSearchParams) {
	const form = new FormData();
	for (const [k, v] of params.entries()) form.append(k, v);
	return form;
}
```

- [ ] **Step 2: Migrate one test file**

Update `src/lib/server/tripExpenses.test.ts` to use `makeFormEvent`/`makeLocals` and remove its local `event` builder.

- [ ] **Step 3: Run tests**

Run: `rtk npx vitest run src/lib/server/tripExpenses.test.ts`
Expected: PASS.

- [ ] **Step 4: Migrate additional test files**

Repeat for `tripCompanions.test.ts`, `tripPolls.test.ts`, `tripDocumentLinks.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add tests/eventHelpers.ts src/lib/server/tripExpenses.test.ts src/lib/server/tripCompanions.test.ts
git commit -m "test(eventHelpers): add shared event builders and migrate tests"
```

---

## Task 10: Shared UI form-field components

**Files:**
- Create: `src/lib/components/FormField.svelte`, `SelectField.svelte`, `TextAreaField.svelte`
- Modify: at least one route page to demonstrate usage

- [ ] **Step 1: Implement FormField**

```svelte
<!-- src/lib/components/FormField.svelte -->
<script lang="ts">
	export let name: string;
	export let label: string;
	export let value: string | number = '';
	export let type = 'text';
	export let error: string | undefined = undefined;
	export let disabled = false;
	export let required = false;
	export let placeholder = '';

	$: inputClass = `input ${error ? 'input-error' : ''}`.trim();
</script>

<label class="label" for={name}>{label}{#if required}<span aria-label="required"> *</span>{/if}</label>
<input
	{id={name}}
	{name}
	{type}
	{value}
	{placeholder}
	{disabled}
	{required}
	class={inputClass}
	on:input
/>
{#if error}<p class="field-error" id="{name}-error">{error}</p>{/if}
```

- [ ] **Step 2: Implement SelectField and TextAreaField**

Same pattern with `<select>`/`<textarea>` and `options` prop for SelectField.

- [ ] **Step 3: Apply to login page**

Update `src/routes/login/+page.svelte` to use `FormField` for email and password inputs.

- [ ] **Step 4: Run check and tests**

Run: `rtk npm run check && rtk npx vitest run src/routes/login/login.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/FormField.svelte src/lib/components/SelectField.svelte src/lib/components/TextAreaField.svelte src/routes/login/+page.svelte
git commit -m "feat(components): add FormField, SelectField, TextAreaField and use on login"
```

---

## Task 11: Centralize constants

**Files:**
- Create: `src/lib/money.ts`, `src/lib/reminderOffsets.ts`, `src/lib/segmentStatus.ts`, `src/lib/visibility.ts`
- Modify: `src/lib/dateFormat.ts`, `src/routes/trips/[id]/+page.svelte`

- [ ] **Step 1: Create money utility**

```ts
// src/lib/money.ts
export function formatCents(cents: number, currency = 'USD'): string {
	return `${(cents / 100).toFixed(2)} ${currency}`;
}
```

- [ ] **Step 2: Create reminder offsets**

```ts
// src/lib/reminderOffsets.ts
export const REMINDER_OFFSETS = [
	{ minutes: 15, label: '15 minutes' },
	{ minutes: 60, label: '1 hour' },
	{ minutes: 180, label: '3 hours' },
	{ minutes: 1440, label: '1 day' },
	{ minutes: 10080, label: '1 week' }
];
```

- [ ] **Step 3: Create segment status and visibility meta**

```ts
// src/lib/segmentStatus.ts
export const SEGMENT_STATUS_META: Record<string, { label: string; class: string }> = {
	planned: { label: 'Planned', class: 'status-planned' },
	confirmed: { label: 'Confirmed', class: 'status-confirmed' },
	// ... etc
};

// src/lib/visibility.ts
export const VISIBILITY_META: Record<string, { label: string; class: string }> = {
	private: { label: 'Private', class: 'vis-private' },
	group: { label: 'Group', class: 'vis-group' },
	public: { label: 'Public', class: 'vis-public' }
};
```

- [ ] **Step 4: Extend dateFormat.ts**

```ts
// src/lib/dateFormat.ts
export function formatDate(iso: string | Date): string {
	const d = typeof iso === 'string' ? new Date(iso) : iso;
	return d.toLocaleDateString();
}

export function formatDateTime(iso: string | Date): string {
	const d = typeof iso === 'string' ? new Date(iso) : iso;
	return d.toLocaleString();
}
```

- [ ] **Step 5: Apply to trip-detail page**

Replace inline `(cents / 100).toFixed(2)` calls with `formatCents`, inline reminder offset arrays with `REMINDER_OFFSETS`, and inline status/visibility maps with the new meta objects.

- [ ] **Step 6: Run check and tests**

Run: `rtk npm run check && rtk npx vitest run src/routes/trips/[id]/trip-detail.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/money.ts src/lib/reminderOffsets.ts src/lib/segmentStatus.ts src/lib/visibility.ts src/lib/dateFormat.ts src/routes/trips/[id]/+page.svelte
git commit -m "refactor(ui): centralize money, reminder offsets, status/visibility meta and date formatting"
```

---

## Final Verification

- [ ] Run full type check: `rtk npm run check`
- [ ] Run full test suite: `rtk npm test`
- [ ] Build production bundle: `DATABASE_PATH=./data/roamarr.db rtk npm run build`
- [ ] Push to master: `rtk git push origin master`

---

## Spec Coverage Check

| Spec Improvement | Plan Task |
|---|---|
| Trip-action wrapper helper | Task 3 |
| Validation helpers | Task 1 |
| Generic owned-row lookup | Task 2 |
| CRUD factory | Task 5 |
| Modularize `tripExpenses.ts` | Task 6 |
| Thin trip-detail route | Task 7 |
| Shared test fixtures | Task 8 |
| Shared test event builders | Task 9 |
| Shared UI form-field components | Task 10 |
| Centralize constants | Task 11 |

All 10 improvements are covered.
