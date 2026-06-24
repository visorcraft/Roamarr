# Roamarr — 10 v0.1 Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 10 walking-skeleton improvements from `docs/superpowers/specs/2026-06-24-roamarr-10-improvements.md`.

**Architecture:** Each task extends an existing seam (reminders, CSV, groups, fare watches, insurance, audit, rate limiting) with small server helpers, thin route actions, and minimal UI changes. No schema changes are required.

**Tech Stack:** SvelteKit 2 / Svelte 5, TypeScript, Drizzle ORM + better-sqlite3, Vitest, Tailwind CSS.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/server/reminders.ts` | Add `listRemindersForUser`, `cancelReminder` (Task 1); generic `messageFor` copy (Task 4). |
| `src/routes/profile/reminders/+page.server.ts` | Load reminders; `cancel` action (Task 1). |
| `src/routes/profile/reminders/+page.svelte` | Render reminder list with cancel buttons (Task 1). |
| `src/routes/+layout.svelte` | Add Profile → Reminders nav link (Task 1). |
| `src/routes/trips/+page.server.ts` | Bulk `delete` action cancels trip-level reminders (Task 2). |
| `src/routes/trips/[id]/edit/+page.server.ts` | `_deleteTrip` cancels trip-level reminders (Task 2). |
| `src/routes/+page.server.ts` | Dashboard uses `u.documentExpiryLeadDays` (Task 3). |
| `src/lib/server/export.ts` | CSV export emits one row per segment (Task 5). |
| `src/lib/server/import.ts` | CSV import groups rows by trip and creates multiple segments (Task 5). |
| `src/lib/server/sharing.ts` | Add `listGroupsForUser` (Task 6). |
| `src/routes/groups/+page.server.ts` | Load owned + member groups (Task 6). |
| `src/routes/trips/[id]/share/+page.server.ts` | Share form loads member groups; `_shareWithGroup` allows owned/belonged groups (Task 6). |
| `src/lib/server/fareproviders/index.ts` | Notify on fare-watch summary change (Task 7). |
| `src/lib/server/insurance.ts` | New helper: list/attach/detach policies (Task 8). |
| `src/routes/trips/[id]/+page.server.ts` | Load available policies; `attachPolicy`/`detachPolicy` actions (Task 8). |
| `src/routes/trips/[id]/+page.svelte` | Sidebar attach/detach policy UI (Task 8). |
| `src/routes/settings/+page.server.ts` | Load recent audit logs for admin (Task 9). |
| `src/routes/settings/+page.svelte` | Render recent audit activity (Task 9). |
| `src/routes/share/[token]/+page.server.ts` | Rate-limit public share loads (Task 10). |
| `src/routes/trips/[id]/calendar/feed/+server.ts` | Rate-limit calendar feed GET (Task 10). |

---

## Task 1: Custom reminder list & cancellation

**Files:**
- Modify: `src/lib/server/reminders.ts`
- Create: `src/routes/profile/reminders/+page.server.ts`
- Create: `src/routes/profile/reminders/+page.svelte`
- Modify: `src/routes/+layout.svelte`
- Test: `src/lib/server/reminders.test.ts`, `src/routes/profile/reminders/reminders.test.ts`

- [ ] **Step 1: Write the failing test for helpers**

```ts
// src/lib/server/reminders.test.ts
import { test, expect, vi, beforeEach } from 'vitest';
const ctx: any = {};
vi.mock('./db', async () => {
  const { freshDb } = await import('../../../tests/helpers');
  Object.assign(ctx, freshDb());
  return ctx;
});
vi.mock('./notify', () => ({ deliver: vi.fn() }));
import { listRemindersForUser, cancelReminder, upsertCustomReminder } from './reminders';
import { users, trips, reminders } from './db/schema';
import { eq } from 'drizzle-orm';

beforeEach(() => {
  ctx.sqlite.exec('delete from reminders; delete from trips; delete from users;');
});

test('listRemindersForUser returns user reminders sorted by fireAt desc', () => {
  const u = ctx.db.insert(users).values({ email: 'a@b.c', passwordHash: 'x', displayName: 'A' }).returning().get();
  ctx.db.insert(reminders).values({ userId: u.id, kind: 'custom', refType: 'trip', refId: 1, fireAt: '2026-01-02T00:00:00Z' }).run();
  ctx.db.insert(reminders).values({ userId: u.id, kind: 'custom', refType: 'trip', refId: 2, fireAt: '2026-01-01T00:00:00Z' }).run();
  const list = listRemindersForUser(u.id);
  expect(list.length).toBe(2);
  expect(list[0].fireAt).toBe('2026-01-02T00:00:00Z');
});

test('cancelReminder deletes only the users own reminder', () => {
  const u1 = ctx.db.insert(users).values({ email: 'a@b.c', passwordHash: 'x', displayName: 'A' }).returning().get();
  const u2 = ctx.db.insert(users).values({ email: 'b@b.c', passwordHash: 'x', displayName: 'B' }).returning().get();
  const r1 = ctx.db.insert(reminders).values({ userId: u1.id, kind: 'custom', refType: 'trip', refId: 1, fireAt: '2026-01-01T00:00:00Z' }).returning().get();
  const r2 = ctx.db.insert(reminders).values({ userId: u2.id, kind: 'custom', refType: 'trip', refId: 2, fireAt: '2026-01-01T00:00:00Z' }).returning().get();
  cancelReminder(u1.id, r1.id);
  expect(ctx.db.select().from(reminders).where(eq(reminders.id, r1.id)).get()).toBeUndefined();
  expect(ctx.db.select().from(reminders).where(eq(reminders.id, r2.id)).get()).toBeDefined();
  expect(() => cancelReminder(u1.id, r2.id)).toThrow(/Not found/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/server/reminders.test.ts`
Expected: FAIL — `listRemindersForUser` / `cancelReminder` not exported.

- [ ] **Step 3: Implement helpers**

```ts
// src/lib/server/reminders.ts (add imports)
import { error } from '@sveltejs/kit';
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';

// add after imports / existing helpers
export function listRemindersForUser(userId: number) {
  return db
    .select()
    .from(reminders)
    .where(eq(reminders.userId, userId))
    .orderBy(desc(reminders.fireAt))
    .all();
}

export function cancelReminder(userId: number, reminderId: number) {
  const r = db.select().from(reminders).where(eq(reminders.id, reminderId)).get();
  if (!r || r.userId !== userId) throw error(404, 'Not found');
  db.delete(reminders).where(eq(reminders.id, reminderId)).run();
}
```

- [ ] **Step 4: Create route load + action**

```ts
// src/routes/profile/reminders/+page.server.ts
import { error, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { cancelReminder, listRemindersForUser } from '$lib/server/reminders';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  const u = requireUser(locals);
  return { reminders: listRemindersForUser(u.id) };
};

export const actions: Actions = {
  cancel: async ({ request, locals }) => {
    const u = requireUser(locals);
    const id = Number((await request.formData()).get('id'));
    if (!Number.isFinite(id) || id <= 0) throw error(400, 'Invalid reminder');
    cancelReminder(u.id, id);
    throw redirect(303, '/profile/reminders');
  }
};
```

- [ ] **Step 5: Create page**

```svelte
<!-- src/routes/profile/reminders/+page.svelte -->
<script lang="ts">
  let { data } = $props();

  const kindLabel: Record<string, string> = {
    flight_checkin: 'Flight check-in',
    document_expiry: 'Document expiry',
    custom: 'Custom'
  };

  function fmt(iso: string | null | undefined) {
    if (!iso) return '';
    try {
      return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
    } catch {
      return iso;
    }
  }
</script>

<header>
  <h1 class="text-3xl font-extrabold text-white">Reminders</h1>
  <p class="mt-1 text-sm text-muted">Scheduled alerts for trips and documents.</p>
</header>

{#if data.reminders.length}
  <ul class="mt-6 space-y-3">
    {#each data.reminders as r (r.id)}
      <li class="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="badge badge-slate">{kindLabel[r.kind] ?? r.kind}</span>
            <span class="badge {r.status === 'pending' ? 'badge-brand' : 'badge-slate'}">{r.status}</span>
          </div>
          <p class="mt-1 font-mono text-xs text-slate-400">{fmt(r.fireAt)}</p>
        </div>
        {#if r.status === 'pending'}
          <form method="POST" action="?/cancel">
            <input type="hidden" name="id" value={r.id} />
            <button class="btn btn-ghost btn-ghost-danger">Cancel</button>
          </form>
        {/if}
      </li>
    {/each}
  </ul>
{:else}
  <div class="card mt-6 grid place-items-center gap-3 p-12 text-center">
    <p class="text-slate-300">No reminders scheduled.</p>
  </div>
{/if}
```

- [ ] **Step 6: Add nav link**

In `src/routes/+layout.svelte`, add a "Reminders" link in the profile sub-nav near Documents/Loyalty:

```svelte
<a href="/profile/reminders" class="...">Reminders</a>
```

- [ ] **Step 7: Run tests**

Run: `npm test -- src/lib/server/reminders.test.ts src/routes/profile/reminders/reminders.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(profile): list and cancel scheduled reminders"
```

---

## Task 2: Clean up trip-level reminders on trip delete

**Files:**
- Modify: `src/routes/trips/+page.server.ts`, `src/routes/trips/[id]/edit/+page.server.ts`
- Test: `src/routes/trips/trips.test.ts`, `src/routes/trips/[id]/trip-detail.test.ts`

- [ ] **Step 1: Add cancellation to bulk delete**

In `src/routes/trips/+page.server.ts` `delete` action:

```ts
for (const id of requireOwnedIds(u.id, ids)) {
  cancelRemindersFor('trip', id);
  const segs = db.select({ id: segments.id }).from(segments).where(eq(segments.tripId, id)).all();
  for (const s of segs) cancelRemindersFor('segment', s.id);
  db.delete(trips).where(eq(trips.id, id)).run();
}
```

- [ ] **Step 2: Add cancellation to single-trip delete**

In `src/routes/trips/[id]/edit/+page.server.ts` `_deleteTrip`:

```ts
export function _deleteTrip(userId: number, tripId: number) {
  requireOwnedTrip(userId, tripId);
  cancelRemindersFor('trip', tripId);
  const segs = db.select({ id: segments.id }).from(segments).where(eq(segments.tripId, tripId)).all();
  for (const s of segs) cancelRemindersFor('segment', s.id);
  db.delete(trips).where(eq(trips.id, tripId)).run();
  logAudit(userId, 'trip_delete', 'trip', tripId);
}
```

- [ ] **Step 3: Add tests**

For `trip-detail.test.ts`:

```ts
import { cancelRemindersFor, upsertCustomReminder } from '$lib/server/reminders';
// ... after deleting a trip via action
expect(db.select().from(reminders).where(eq(reminders.refType, 'trip')).all()).toHaveLength(0);
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/routes/trips/trips.test.ts src/routes/trips/[id]/trip-detail.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix(reminders): cancel trip-level reminders when a trip is deleted"
```

---

## Task 3: Respect per-user document expiry lead on dashboard

**Files:**
- Modify: `src/routes/+page.server.ts`
- Test: `src/routes/dashboard.test.ts`

- [ ] **Step 1: Update dashboard load**

```ts
// src/routes/+page.server.ts
export const load: PageServerLoad = ({ locals }) => {
  const u = requireUser(locals);
  const today = DateTime.utc().toISODate()!;
  const soon = DateTime.utc().plus({ days: u.documentExpiryLeadDays }).toISODate()!;
  // ... rest unchanged
};
```

- [ ] **Step 2: Add test**

```ts
// src/routes/dashboard.test.ts
import { test, expect, vi } from 'vitest';
const ctx: any = {};
vi.mock('$lib/server/db', async () => {
  const { freshDb } = await import('../../../tests/helpers');
  Object.assign(ctx, freshDb());
  return ctx;
});
import { load } from './+page.server';
import { users, travelDocuments, settings } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

test('dashboard uses user document expiry lead', () => {
  ctx.db.update(settings).set({ setupComplete: true }).where(eq(settings.id, 1)).run();
  const u = ctx.db.insert(users).values({ email: 'a@b.c', passwordHash: 'x', displayName: 'A', documentExpiryLeadDays: 30 }).returning().get();
  ctx.db.insert(travelDocuments).values({ userId: u.id, type: 'passport', expiresOn: '2026-08-24' }).run();
  const data = load({ locals: { user: u } } as any);
  expect(data.expiring).toHaveLength(0);
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -- src/routes/dashboard.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "fix(dashboard): use per-user document expiry lead"
```

---

## Task 4: Generic reminder notification copy

**Files:**
- Modify: `src/lib/server/reminders.ts`
- Test: `src/lib/server/reminders.test.ts`

- [ ] **Step 1: Update messageFor**

```ts
function messageFor(r: Reminder): { title: string; body: string; link: string } {
  if (r.kind === 'flight_checkin') {
    return { title: 'Check-in reminder', body: 'A flight you track is departing soon.', link: '/trips' };
  }
  if (r.kind === 'document_expiry') {
    return { title: 'Document expiring', body: 'A travel document is expiring soon.', link: '/profile/documents' };
  }
  return {
    title: 'Reminder',
    body: 'A scheduled reminder is due.',
    link: r.refType === 'trip' ? `/trips/${r.refId}` : '/trips'
  };
}
```

- [ ] **Step 2: Update any tests asserting old strings**

In `reminders.test.ts`, change assertions to match generic copy.

- [ ] **Step 3: Run tests**

Run: `npm test -- src/lib/server/reminders.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "fix(reminders): generic notification copy that matches configurable leads"
```

---

## Task 5: Round-trip CSV export/import

**Files:**
- Modify: `src/lib/server/export.ts`, `src/lib/server/import.ts`
- Test: `src/lib/server/export.test.ts`, `src/lib/server/import.test.ts`

- [ ] **Step 1: Update CSV export to one row per segment**

```ts
export function exportTripsCsv(userId: number): string {
  const rows = exportTrips(userId);
  const headers = [
    'name', 'destination', 'startDate', 'endDate', 'notes', 'tags', 'defaultVisibility',
    'segmentType', 'segmentTitle', 'segmentLocalStart', 'segmentStartTz', 'segmentEndAt',
    'segmentLocation', 'segmentConfirmationNumber'
  ];
  const lines: string[][] = [headers];
  for (const t of rows) {
    const segs = t.segments?.length ? t.segments : [undefined];
    for (const s of segs) {
      lines.push([
        csvEscape(t.name),
        csvEscape(t.destination),
        csvEscape(t.startDate),
        csvEscape(t.endDate),
        csvEscape(t.notes),
        csvEscape((t.tags ?? []).join(',')),
        csvEscape(t.defaultVisibility),
        csvEscape(s?.type),
        csvEscape(s?.title),
        csvEscape(s?.localStart),
        csvEscape(s?.startTz),
        csvEscape(s?.endAt),
        csvEscape(s?.location),
        csvEscape(s?.confirmationNumber)
      ]);
    }
  }
  return lines.map((r) => r.join(',')).join('\n') + '\n';
}
```

- [ ] **Step 2: Update CSV import to group rows by trip**

Replace `parseCsv` body:

```ts
export function parseCsv(text: string): { trips: ImportTrip[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('CSV must have a header and at least one data row');
  const headers = parseCsvLine(lines[0]!);
  const groups = new Map<string, ImportTrip>();
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]!);
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]!] = row[j] ?? '';
    }
    const key = `${obj.name}|${obj.startDate}|${obj.endDate}`;
    let trip = groups.get(key);
    if (!trip) {
      trip = {
        name: obj.name || '',
        destination: obj.destination || undefined,
        startDate: obj.startDate || undefined,
        endDate: obj.endDate || undefined,
        notes: obj.notes || undefined,
        defaultVisibility: obj.defaultVisibility || 'private',
        segments: []
      };
      groups.set(key, trip);
    }
    if (obj.segmentType) {
      trip.segments!.push({
        type: obj.segmentType as SegmentType,
        title: obj.segmentTitle || obj.segmentType,
        localStart: obj.segmentLocalStart || '',
        startTz: obj.segmentStartTz || 'UTC',
        endAt: obj.segmentEndAt || undefined,
        location: obj.segmentLocation || undefined,
        confirmationNumber: obj.segmentConfirmationNumber || undefined
      });
    }
  }
  return { trips: Array.from(groups.values()) };
}
```

- [ ] **Step 3: Add round-trip tests**

```ts
// src/lib/server/export.test.ts
import { exportTripsCsv } from './export';
import { importTrips, parseCsv } from './import';
// create a user, trip with two flight segments, then:
const csv = exportTripsCsv(user.id);
const parsed = parseCsv(csv);
const result = importTrips(user.id, parsed);
expect(result.imported).toBe(1);
expect(result.segmentCount).toBe(2);
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/lib/server/export.test.ts src/lib/server/import.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(import): round-trip CSV export/import with one row per segment"
```

---

## Task 6: Groups I belong to + share with member groups

**Files:**
- Modify: `src/lib/server/sharing.ts`, `src/routes/groups/+page.server.ts`, `src/routes/trips/[id]/share/+page.server.ts`
- Test: `src/routes/groups/groups.test.ts`, `src/routes/trips/[id]/share/share.test.ts`

- [ ] **Step 1: Add helper in sharing.ts**

```ts
// src/lib/server/sharing.ts
import { and, eq, inArray } from 'drizzle-orm';

export function listGroupsForUser(userId: number) {
  const owned = db.select({ id: groups.id }).from(groups).where(eq(groups.ownerId, userId)).all();
  const member = db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId))
    .all();
  const ids = Array.from(new Set([...owned.map((g) => g.id), ...member.map((m) => m.groupId)]));
  if (ids.length === 0) return [];
  return db.select().from(groups).where(inArray(groups.id, ids)).all();
}
```

- [ ] **Step 2: Update groups page load**

```ts
// src/routes/groups/+page.server.ts
import { listGroupsForUser } from '$lib/server/sharing';

export const load: PageServerLoad = ({ locals }) => {
  const u = requireUser(locals);
  const all = listGroupsForUser(u.id);
  return {
    groups: all.map((g) => ({
      ...g,
      members: db
        .select({ id: users.id, email: users.email })
        .from(groupMembers)
        .innerJoin(users, eq(groupMembers.userId, users.id))
        .where(eq(groupMembers.groupId, g.id))
        .all()
    }))
  };
};
```

- [ ] **Step 3: Update share page**

In `src/routes/trips/[id]/share/+page.server.ts`:

```ts
import { listGroupsForUser } from '$lib/server/sharing';

// in load, replace `myGroups` with:
const myGroups = listGroupsForUser(u.id);

// in _shareWithGroup, replace owner check with:
const allowed = listGroupsForUser(ownerId).some((g) => g.id === groupId);
if (!allowed) throw error(404, 'No such group');
```

- [ ] **Step 4: Add tests**

```ts
// share.test.ts
import { listGroupsForUser } from '$lib/server/sharing';
test('member can share trip into a group they belong to', () => {
  // owner creates group, adds member; member shares their own trip to the group
});
```

- [ ] **Step 5: Run tests**

Run: `npm test -- src/routes/groups/groups.test.ts src/routes/trips/[id]/share/share.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(groups): allow sharing into groups the user belongs to"
```

---

## Task 7: Fare-watch change alerts

**Files:**
- Modify: `src/lib/server/fareproviders/index.ts`
- Test: `src/lib/server/fareproviders/fareproviders.test.ts`

- [ ] **Step 1: Refactor fare update and notify on change**

Extract a helper in `src/lib/server/fareproviders/index.ts`:

```ts
import { deliver } from '../notify';

async function applyResult(watchId: number, userId: number, tripId: number, result: FareResult, now: Date) {
  const existing = db.select().from(fareWatches).where(eq(fareWatches.id, watchId)).get();
  const previousSummary = existing?.lastResultJson ? (JSON.parse(existing.lastResultJson) as FareResult).summary : null;
  db.update(fareWatches)
    .set({ lastResultJson: JSON.stringify(result), lastCheckedAt: now.toISOString() })
    .where(eq(fareWatches.id, watchId))
    .run();
  if (previousSummary !== null && result.summary !== previousSummary) {
    await deliver(userId, {
      title: 'Fare watch update',
      body: 'A fare watch result changed.',
      link: `/trips/${tripId}`
    });
  }
}
```

Call `applyResult` from both `checkWatch` and `runFareChecks` instead of the inline update.

- [ ] **Step 2: Update tests**

```ts
import { deliver } from '$lib/server/notify';
vi.mock('$lib/server/notify', () => ({ deliver: vi.fn() }));

test('notifies on fare watch summary change', async () => {
  // set up watch with previous result, run check with new summary, assert deliver called
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -- src/lib/server/fareproviders/fareproviders.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(fare-watch): notify user when fare check summary changes"
```

---

## Task 8: Attach/detach insurance policies from trip detail

**Files:**
- Create: `src/lib/server/insurance.ts`
- Modify: `src/routes/trips/[id]/+page.server.ts`, `src/routes/trips/[id]/+page.svelte`
- Test: `src/routes/trips/[id]/trip-detail.test.ts`

- [ ] **Step 1: Create insurance helper**

```ts
// src/lib/server/insurance.ts
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { insurancePolicies } from './db/schema';

export function listPoliciesForUser(userId: number) {
  return db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, userId)).all();
}

export function attachPolicyToTrip(userId: number, policyId: number, tripId: number) {
  const p = db
    .select()
    .from(insurancePolicies)
    .where(and(eq(insurancePolicies.id, policyId), eq(insurancePolicies.userId, userId)))
    .get();
  if (!p) throw error(404, 'Not found');
  db.update(insurancePolicies).set({ tripId }).where(eq(insurancePolicies.id, policyId)).run();
}

export function detachPolicyFromTrip(userId: number, policyId: number) {
  const p = db
    .select()
    .from(insurancePolicies)
    .where(and(eq(insurancePolicies.id, policyId), eq(insurancePolicies.userId, userId)))
    .get();
  if (!p) throw error(404, 'Not found');
  db.update(insurancePolicies).set({ tripId: null }).where(eq(insurancePolicies.id, policyId)).run();
}
```

- [ ] **Step 2: Update trip detail load + actions**

In `src/routes/trips/[id]/+page.server.ts`:

```ts
import { attachPolicyToTrip, detachPolicyFromTrip, listPoliciesForUser } from '$lib/server/insurance';

// inside owner branch of load:
const allPolicies = listPoliciesForUser(u.id);
const policies = allPolicies.filter((p) => p.tripId === view.trip.id);
const availablePolicies = allPolicies.filter((p) => p.tripId !== view.trip.id);
// return includes policies, availablePolicies

// add actions:
attachPolicy: async ({ request, locals, params }) => {
  const u = requireUser(locals);
  const tripId = Number(params.id);
  requireOwnedTrip(u.id, tripId);
  const policyId = Number((await request.formData()).get('policyId'));
  if (!Number.isFinite(policyId) || policyId <= 0) throw error(400, 'Invalid policy');
  attachPolicyToTrip(u.id, policyId, tripId);
  throw redirect(303, `/trips/${tripId}`);
},
detachPolicy: async ({ request, locals, params }) => {
  const u = requireUser(locals);
  const tripId = Number(params.id);
  requireOwnedTrip(u.id, tripId);
  const policyId = Number((await request.formData()).get('policyId'));
  if (!Number.isFinite(policyId) || policyId <= 0) throw error(400, 'Invalid policy');
  detachPolicyFromTrip(u.id, policyId);
  throw redirect(303, `/trips/${tripId}`);
}
```

- [ ] **Step 3: Add UI in sidebar**

In `src/routes/trips/[id]/+page.svelte`, inside the existing insurance sidebar block:

```svelte
{#if data.owner === true && data.availablePolicies?.length}
  <form method="POST" action="?/attachPolicy" class="mt-3 flex flex-col gap-2">
    <select name="policyId" class="input text-sm">
      {#each data.availablePolicies as p}
        <option value={p.id}>{p.provider}{#if p.policyNumber} — {p.policyNumber}{/if}</option>
      {/each}
    </select>
    <button class="btn btn-primary btn-sm">Attach policy</button>
  </form>
{/if}

{#each data.policies as p}
  <li class="...">
    <!-- existing policy display -->
    {#if data.owner === true}
      <form method="POST" action="?/detachPolicy">
        <input type="hidden" name="policyId" value={p.id} />
        <button class="btn btn-ghost btn-ghost-danger btn-sm">Detach</button>
      </form>
    {/if}
  </li>
{/each}
```

- [ ] **Step 4: Add tests**

```ts
// trip-detail.test.ts
test('owner can attach and detach a policy from trip detail', async () => {
  // create policy, call attach action, assert tripId set; call detach, assert null
});
```

- [ ] **Step 5: Run tests**

Run: `npm test -- src/routes/trips/[id]/trip-detail.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(trip-detail): attach and detach insurance policies"
```

---

## Task 9: Recent audit activity on admin dashboard

**Files:**
- Modify: `src/routes/settings/+page.server.ts`, `src/routes/settings/+page.svelte`
- Test: `src/routes/settings/settings.test.ts`

- [ ] **Step 1: Load recent audit logs**

```ts
// src/routes/settings/+page.server.ts
import { listAuditLogs } from '$lib/server/audit';

export const load: PageServerLoad = ({ locals }) => {
  requireAdmin(locals);
  // ... existing stats ...
  const { logs: recentAudit } = listAuditLogs({ limit: 10 });
  return { settings: ..., stats, recentAudit };
};
```

- [ ] **Step 2: Render on settings page**

After the stats grid in `src/routes/settings/+page.svelte`:

```svelte
<section class="card mt-6 p-5 sm:p-6">
  <h2 class="section-title">Recent security events</h2>
  {#if data.recentAudit.length}
    <ul class="mt-4 divide-y divide-white/5">
      {#each data.recentAudit as log (log.id)}
        <li class="py-3">
          <p class="text-sm text-slate-200">
            <span class="font-medium text-white">{log.user.displayName}</span>
            <span class="text-slate-400">{log.action}</span>
            <span class="font-mono text-xs text-slate-500">{log.entityType}:{log.entityId}</span>
          </p>
          <p class="mt-0.5 font-mono text-xs text-slate-500">{log.createdAt}</p>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="mt-4 text-sm text-slate-500">No audit events yet.</p>
  {/if}
</section>
```

- [ ] **Step 3: Add tests**

```ts
// settings.test.ts
test('admin load includes recent audit logs', () => {
  // create admin, log an event, call load, assert recentAudit has it
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/routes/settings/settings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(settings): show recent audit activity for admins"
```

---

## Task 10: Rate-limit public share & calendar feed endpoints

**Files:**
- Modify: `src/routes/share/[token]/+page.server.ts`, `src/routes/trips/[id]/calendar/feed/+server.ts`
- Test: `src/routes/share/share.test.ts`, `src/routes/trips/[id]/calendar/feed/feed.test.ts`

- [ ] **Step 1: Add rate limiting to share page**

```ts
// src/routes/share/[token]/+page.server.ts
import { checkRateLimit } from '$lib/server/rateLimit';

export const load: PageServerLoad = (event) => {
  const ip = event.getClientAddress();
  const limited = checkRateLimit(ip, 'share', { maxAttempts: 30, windowMs: 60_000 });
  if (!limited.allowed) throw error(429, 'Too many requests');
  return _loadByToken(event.params.token);
};
```

- [ ] **Step 2: Add rate limiting to calendar feed**

```ts
// src/routes/trips/[id]/calendar/feed/+server.ts
import { checkRateLimit } from '$lib/server/rateLimit';

export const GET: RequestHandler = (event) => {
  const ip = event.getClientAddress();
  const limited = checkRateLimit(ip, 'calendar_feed', { maxAttempts: 60, windowMs: 60_000 });
  if (!limited.allowed) throw error(429, 'Too many requests');
  // ... existing handler ...
};
```

- [ ] **Step 3: Add tests**

For `feed.test.ts`:

```ts
import { checkRateLimit, resetRateLimit } from '$lib/server/rateLimit';

beforeEach(() => resetRateLimit());

test('returns 429 after exceeding rate limit', () => {
  // create trip with calendar token
  for (let i = 0; i < 31; i++) checkRateLimit('1.2.3.4', 'calendar_feed', { maxAttempts: 30, windowMs: 60_000 });
  const response = GET({ params: { id: String(trip.id) }, url: new URL(`?token=${token}`, 'http://x'), getClientAddress: () => '1.2.3.4' } as any);
  expect(response.status).toBe(429);
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/routes/share/share.test.ts src/routes/trips/[id]/calendar/feed/feed.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "security: rate-limit public share and calendar feed endpoints"
```

---

## Final verification

- [ ] Run `npm run check`
- [ ] Run `npm test`
- [ ] Run `npm run build`
- [ ] Push to `master`
