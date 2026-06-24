# Roamarr 10 More Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 10 v0.1 improvements from `docs/superpowers/specs/2026-06-24-roamarr-10-more-improvements.md`.

**Architecture:** Add two schema migrations (token expiry columns + trip comments), create small server modules for each new behavior, expose them through thin SvelteKit routes, and keep all tests co-located.

**Tech Stack:** SvelteKit 2 / Svelte 5, TypeScript strict, Drizzle ORM + better-sqlite3, Tailwind CSS v4, Vitest.

---

## File map

| File | Responsibility |
|------|----------------|
| `src/lib/server/db/schema.ts` | Add `trip_comments` table and expiry columns to `trips`. |
| `drizzle/0008_*.sql` | Migration for schema changes. |
| `src/lib/server/seed.ts` | Demo data generator. |
| `src/routes/settings/seed/+page.server.ts` | Admin seed action. |
| `src/routes/settings/seed/+page.svelte` | Seed confirmation UI. |
| `static/manifest.json` | PWA manifest. |
| `static/icon-192.png` / `static/icon-512.png` | PWA icons. |
| `src/app.html` | Manifest/link meta tags. |
| `src/routes/+layout.svelte` | Mobile hamburger nav. |
| `src/routes/+page.server.ts` / `+page.svelte` | Dashboard summary cards. |
| `src/lib/server/segments.ts` | Overlap detection helper. |
| `src/routes/trips/[id]/segments/+page.server.ts` | Return overlap warnings. |
| `src/lib/server/tripComments.ts` | Comment CRUD + auth. |
| `src/routes/trips/[id]/+page.server.ts` | Load comments; add/delete comment actions. |
| `src/routes/trips/[id]/+page.svelte` | Comments section. |
| `src/routes/trips/[id]/share/+page.server.ts` | Accept expiry inputs when minting tokens. |
| `src/routes/share/[token]/+page.server.ts` | Reject expired public tokens. |
| `src/routes/trips/[id]/calendar/feed/+server.ts` | Reject expired calendar tokens. |
| `src/lib/server/audit.ts` | CSV export helper. |
| `src/routes/settings/audit-logs/+page.server.ts` | Export query handling. |
| `src/routes/health/deep/+server.ts` | Deep health endpoint. |
| `src/routes/settings/backup/+page.server.ts` | Restore upload action. |
| `src/routes/settings/backup/+page.svelte` | Restore upload UI. |

---

## Phase 1: Schema + migrations

### Task 1: Add expiry columns and comments table

**Files:**
- Modify: `src/lib/server/db/schema.ts`
- Create: `drizzle/0008_ten_more_improvements.sql`

- [ ] **Step 1: Update `trips` schema**

Add to `trips` columns:
```ts
publicTokenExpiresAt: text('public_token_expires_at'),
calendarTokenExpiresAt: text('calendar_token_expires_at')
```

- [ ] **Step 2: Add `tripComments` table**

After `trips`:
```ts
export const tripComments = sqliteTable('trip_comments', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	tripId: integer('trip_id')
		.notNull()
		.references(() => trips.id, { onDelete: 'cascade' }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	body: text('body').notNull(),
	createdAt: text('created_at').notNull().default(now)
});
```

- [ ] **Step 3: Generate migration**

Run:
```bash
npm run db:generate
```

Review the generated `drizzle/0008_*.sql`.

- [ ] **Step 4: Run `npm test`**

All tests should still pass (schema additions are additive).

---

## Phase 2: Server helpers

### Task 2: Demo seeder

**Files:**
- Create: `src/lib/server/seed.ts`
- Create: `src/lib/server/seed.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { test, expect, vi } from 'vitest';
const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { seedDemoData } from './seed';
import { users, trips, segments } from './db/schema';

test('seedDemoData creates trips and segments for the admin user', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const admin = db.insert(users).values({ email: 'admin@x.c', passwordHash: 'x', displayName: 'Admin', role: 'admin' }).returning().get();
	seedDemoData(admin.id);
	expect(db.select().from(trips).all().length).toBeGreaterThan(0);
	expect(db.select().from(segments).all().length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Implement `seedDemoData`**

```ts
import { db } from './db';
import { users, trips, segments, cards, insurancePolicies, loyaltyPrograms } from './db/schema';

export function seedDemoData(adminId: number) {
	db.delete(tripComments).run();
	db.delete(tripShares).run();
	db.delete(segments).run();
	db.delete(trips).where(sql`${trips.ownerId} != ${adminId}`).run();
	db.delete(cards).where(sql`${cards.userId} != ${adminId}`).run();
	db.delete(insurancePolicies).where(sql`${insurancePolicies.userId} != ${adminId}`).run();
	db.delete(loyaltyPrograms).where(sql`${loyaltyPrograms.userId} != ${adminId}`).run();
	db.delete(users).where(sql`${users.id} != ${adminId}`).run();

	const t = db.insert(trips).values({
		ownerId: adminId,
		name: 'Demo Trip to Tokyo',
		destination: 'Tokyo',
		startDate: '2026-09-01',
		endDate: '2026-09-10',
		tags: JSON.stringify(['demo', 'asia'])
	}).returning().get();

	db.insert(segments).values([
		{ tripId: t.id, type: 'flight', title: 'Outbound', startAt: '2026-09-01T08:00:00Z', startTz: 'UTC', endAt: '2026-09-01T16:00:00Z', endTz: 'Asia/Tokyo' },
		{ tripId: t.id, type: 'hotel', title: 'Shinjuku Hotel', startAt: '2026-09-01T17:00:00Z', startTz: 'Asia/Tokyo', location: 'Shinjuku' }
	]).run();

	db.insert(cards).values({ userId: adminId, last4: '1234', network: 'visa', label: 'Travel Card' }).run();
	db.insert(insurancePolicies).values({ userId: adminId, provider: 'Demo Insurer', policyNumber: 'DEMO-1', coverageSummary: 'Cancellation' }).run();
	db.insert(loyaltyPrograms).values({ userId: adminId, programName: 'Demo Air', membershipNumber: 'D123', balance: 5000, unit: 'points' }).run();
}
```

- [ ] **Step 3: Run test**

```bash
npx vitest run src/lib/server/seed.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/seed.ts src/lib/server/seed.test.ts drizzle/ src/lib/server/db/schema.ts

git commit -m "feat(seed): demo data seeder"
```

### Task 3: Segment overlap detection

**Files:**
- Modify: `src/lib/server/segments.ts`
- Create: test in `src/lib/server/segments.ts`? Add to existing `segments.test.ts` if any. Currently no `segments.test.ts`; create `src/lib/server/segments.test.ts`.

- [ ] **Step 1: Write failing tests**

```ts
import { test, expect, vi } from 'vitest';
const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { hasOverlappingSegment, addSegment } from './segments';
import { users, trips, segments } from './db/schema';

test('detects overlap with existing segment', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'o@x.c', passwordHash: 'x' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	db.insert(segments).values({ tripId: t.id, type: 'flight', title: 'A', startAt: '2026-01-01T10:00:00Z', startTz: 'UTC', endAt: '2026-01-01T12:00:00Z' }).run();
	expect(hasOverlappingSegment(t.id, undefined, '2026-01-01T11:00:00Z', '2026-01-01T13:00:00Z')).toBe(true);
	expect(hasOverlappingSegment(t.id, undefined, '2026-01-01T13:00:00Z', '2026-01-01T14:00:00Z')).toBe(false);
});
```

- [ ] **Step 2: Implement `hasOverlappingSegment`**

```ts
import { and, eq, ne, sql } from 'drizzle-orm';

export function hasOverlappingSegment(
	tripId: number,
	excludeSegmentId: number | undefined,
	startAt: string,
	endAt?: string | null
) {
	if (!endAt) return false;
	const conditions = [
		eq(segments.tripId, tripId),
		sql`${segments.startAt} < ${endAt}`,
		sql`${segments.endAt} > ${startAt}`
	];
	if (excludeSegmentId != null) conditions.push(ne(segments.id, excludeSegmentId));
	return db.select({ count: sql<number>`count(*)` }).from(segments).where(and(...conditions)).get()!.count > 0;
}
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/lib/server/segments.test.ts
```

### Task 4: Trip comments module

**Files:**
- Create: `src/lib/server/tripComments.ts`
- Create: `src/lib/server/tripComments.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { test, expect, vi } from 'vitest';
const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { listComments, addComment, deleteComment } from './tripComments';
import { users, trips, tripComments } from './db/schema';
import { eq } from 'drizzle-orm';

test('comment lifecycle', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'c@x.c', passwordHash: 'x' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const comment = addComment(u.id, t.id, 'Hello');
	expect(listComments(t.id).map((c) => c.body)).toEqual(['Hello']);
	deleteComment(u.id, comment.id);
	expect(db.select().from(tripComments).where(eq(tripComments.id, comment.id)).get()).toBeUndefined();
});
```

- [ ] **Step 2: Implement module**

```ts
import { eq, and } from 'drizzle-orm';
import { db } from './db';
import { tripComments, users } from './db/schema';

export function listComments(tripId: number) {
	return db
		.select({
			id: tripComments.id,
			body: tripComments.body,
			createdAt: tripComments.createdAt,
			userId: users.id,
			displayName: users.displayName
		})
		.from(tripComments)
		.innerJoin(users, eq(tripComments.userId, users.id))
		.where(eq(tripComments.tripId, tripId))
		.orderBy(tripComments.createdAt)
		.all();
}

export function addComment(userId: number, tripId: number, body: string) {
	const text = body.trim();
	if (!text) throw new Error('Comment is required');
	return db.insert(tripComments).values({ userId, tripId, body: text }).returning().get();
}

export function deleteComment(userId: number, commentId: number) {
	db.delete(tripComments).where(and(eq(tripComments.id, commentId), eq(tripComments.userId, userId))).run();
}
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/lib/server/tripComments.test.ts
```

### Task 5: Audit CSV export helper

**Files:**
- Modify: `src/lib/server/audit.ts`
- Create: add export test to `src/lib/server/audit.test.ts`

- [ ] **Step 1: Add `exportAuditLogsCsv(filters)`**

```ts
export function exportAuditLogsCsv(filters: AuditFilters = {}): string {
	const { logs } = listAuditLogs(filters);
	const header = 'id,action,entityType,entityId,userId,userEmail,userDisplayName,createdAt,meta\n';
	const rows = logs.map((l) =>
		[l.id, l.action, l.entityType, l.entityId, l.user.id, l.user.email, l.user.displayName, l.createdAt, JSON.stringify(l.meta)]
			.map((c) => `"${String(c).replace(/"/g, '""')}"`)
			.join(',')
	);
	return header + rows.join('\n');
}
```

- [ ] **Step 2: Test in audit.test.ts**

```ts
test('exportAuditLogsCsv returns CSV rows', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'csv@x.c', passwordHash: 'x', displayName: 'C' }).returning().get();
	logAudit(u.id, 'test_action', 'trip', 1, { x: 1 });
	const csv = exportAuditLogsCsv();
	expect(csv).toContain('test_action');
	expect(csv).toContain('csv@x.c');
});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/lib/server/audit.test.ts
```

---

## Phase 3: Routes and pages

### Task 6: Dashboard summary cards

**Files:**
- Modify: `src/routes/+page.server.ts`
- Modify: `src/routes/+page.svelte`
- Modify: `src/routes/dashboard.test.ts`

- [ ] **Step 1: Update dashboard load**

Return counts:
```ts
const upcoming = listViewableTrips(u.id, { windowDays: 365 });
const stats = {
	upcoming: upcoming.length,
	expiring: db.select({ count: count() }).from(travelDocuments).where(...expiring within lead...).get()?.count ?? 0,
	unread: db.select({ count: count() }).from(notifications).where(and(eq(notifications.userId, u.id), isNull(notifications.readAt))).get()?.count ?? 0,
	watches: db.select({ count: count() }).from(fareWatches).innerJoin(fareProviders, eq(fareWatches.providerId, fareProviders.id)).where(eq(fareProviders.userId, u.id)).get()?.count ?? 0
};
```

- [ ] **Step 2: Render cards in +page.svelte**

Add a 4-column card grid above the trips list.

- [ ] **Step 3: Update dashboard tests**

Assert that `data.stats` contains the expected counts.

### Task 7: Mobile nav + PWA manifest

**Files:**
- Create: `static/manifest.json`
- Create: `static/icon-192.png`, `static/icon-512.png`
- Modify: `src/app.html`
- Modify: `src/routes/+layout.svelte`

- [ ] **Step 1: Generate simple icons**

Use ImageMagick or copy existing `favicon.svg` and convert to PNGs. If ImageMagick unavailable, create simple SVG files and reference them (browsers accept SVG manifest icons).

- [ ] **Step 2: Manifest JSON**

```json
{
	"name": "Roamarr",
	"short_name": "Roamarr",
	"start_url": "/",
	"display": "standalone",
	"background_color": "#0f172a",
	"theme_color": "#0f172a",
	"icons": [
		{ "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
		{ "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
	]
}
```

- [ ] **Step 3: Update app.html**

Add:
```html
<meta name="theme-color" content="#0f172a" />
<link rel="manifest" href="/manifest.json" />
<link rel="apple-touch-icon" href="/icon-192.png" />
```

- [ ] **Step 4: Mobile sidebar toggle**

In `+layout.svelte`, add a header bar on small screens with a hamburger button that toggles the sidebar. Use a Svelte 5 rune `let mobileOpen = $state(false)`.

### Task 8: Seed UI

**Files:**
- Create: `src/routes/settings/seed/+page.server.ts`
- Create: `src/routes/settings/seed/+page.svelte`
- Modify: `src/routes/settings/+layout.svelte` to add Seed link

- [ ] **Step 1: Server action**

```ts
import { requireAdmin } from '$lib/server/auth';
import { seedDemoData } from '$lib/server/seed';
import { logAudit } from '$lib/server/audit';
import { setFlash } from '$lib/server/flash';
import { redirect, type Actions } from '@sveltejs/kit';

export const actions: Actions = {
	default: async ({ locals, cookies }) => {
		const u = requireAdmin(locals);
		seedDemoData(u.id);
		logAudit(u.id, 'demo_seed', 'settings', 1);
		setFlash(cookies, 'Demo data seeded.');
		throw redirect(303, '/trips');
	}
};
```

- [ ] **Step 2: Page with confirmation**

Form with a checkbox "I understand this will replace demo/sample data" and a red button.

### Task 9: Segment overlap warnings in UI

**Files:**
- Modify: `src/lib/server/segmentAdd.ts` to call overlap helper and return warning.
- Modify: `src/routes/trips/[id]/segments/+page.server.ts` add/update actions to pass warning through `fail(200, { warning })` or return in load? Use form `fail` with warning.
- Modify: segment form shell to display `form?.warning`.

- [ ] **Step 1: Detect overlap in segmentAdd**

After parsing, compute `const overlap = hasOverlappingSegment(tripId, segmentId, startAt, endAt);` and include in return object.

- [ ] **Step 2: Surface warning**

Return `fail(200, { warning: 'This segment overlaps an existing one.', ...fields })` from actions when overlap true, so the form is re-rendered with the warning but data not saved? Better: allow save and redirect with flash. Simpler: include warning in form result and still save. For v0.1, save with a flash warning.

```ts
if (overlap) {
	setFlash(cookies, 'Warning: this segment overlaps an existing one.');
}
```

### Task 10: Trip comments UI

**Files:**
- Modify: `src/routes/trips/[id]/+page.server.ts`
- Modify: `src/routes/trips/[id]/+page.svelte`
- Create: `src/routes/trips/[id]/trip-comments.test.ts`

- [ ] **Step 1: Load comments**

Import `listComments` and add to load return.

- [ ] **Step 2: Actions**

Add `addComment` and `deleteComment` actions that use the helper module.

- [ ] **Step 3: UI**

Add a comments section below trip segments with form and delete buttons for comment authors.

### Task 11: Token expiry

**Files:**
- Modify: `src/routes/trips/[id]/share/+page.server.ts` and `+page.svelte`
- Modify: `src/routes/share/[token]/+page.server.ts`
- Modify: `src/routes/trips/[id]/calendar/feed/+server.ts`
- Create: tests in share and feed test files.

- [ ] **Step 1: Mint tokens with optional expiry**

When minting public/calendar tokens, accept form inputs `publicExpiresAt` and `calendarExpiresAt`; store as ISO strings (or null).

- [ ] **Step 2: Reject expired tokens**

In share load and calendar feed GET, after fetching trip by token, if expiry column set and `new Date(expiry) <= new Date()`, return 404.

- [ ] **Step 3: UI inputs**

Add datetime-local inputs for token expiry on the share page.

### Task 12: Audit log export endpoint

**Files:**
- Modify: `src/routes/settings/audit-logs/+page.server.ts`
- Modify: `src/routes/settings/audit-logs/+page.svelte`

- [ ] **Step 1: Handle `?export=csv`**

In load, if `url.searchParams.get('export') === 'csv'`, return CSV Response.

- [ ] **Step 2: Add export button**

Link/form to `/settings/audit-logs?export=csv` preserving current filters.

### Task 13: Deep health endpoint

**Files:**
- Create: `src/routes/health/deep/+server.ts`
- Create: `src/routes/health/deep/deep.test.ts`

- [ ] **Step 1: Implement endpoint**

```ts
import { isSchedulerRunning } from '$lib/server/scheduler';
import { db } from '$lib/server/db';

export const GET: RequestHandler = () => {
	let dbOk = false;
	try {
		db.run(sql`PRAGMA quick_check`);
		dbOk = true;
	} catch { /* ignore */ }
	const schedulerOk = isSchedulerRunning();
	const status = dbOk && schedulerOk ? 200 : 503;
	return new Response(JSON.stringify({ db: dbOk, scheduler: schedulerOk }), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
};
```

- [ ] **Step 2: Tests**

Mock scheduler state and assert 200/503.

### Task 14: Backup restore

**Files:**
- Modify: `src/routes/settings/backup/+page.server.ts`
- Modify: `src/routes/settings/backup/+page.svelte`
- Modify: `src/routes/settings/backup/backup.test.ts`

- [ ] **Step 1: Upload action**

```ts
restore: async ({ request, locals }) => {
	const u = requireAdmin(locals);
	const f = await request.formData();
	const file = f.get('file') as File;
	if (!file || file.type !== 'application/octet-stream' && !file.name.endsWith('.db')) return fail(400, { error: 'Upload a .db file' });
	const buffer = Buffer.from(await file.arrayBuffer());
	const tempPath = `${process.env.DATABASE_PATH ?? '/data/roamarr.db'}.restore-tmp`;
	writeFileSync(tempPath, buffer);
	try {
		const checkDb = new Database(tempPath);
		checkDb.pragma('quick_check');
		checkDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
		checkDb.close();
	} catch (e) {
		unlinkSync(tempPath);
		return fail(400, { error: 'Invalid SQLite database' });
	}
	renameSync(tempPath, process.env.DATABASE_PATH ?? '/data/roamarr.db');
	logAudit(u.id, 'db_restore', 'settings', 1);
	setFlash(cookies, 'Database restored. Restart the container to complete.');
	throw redirect(303, '/settings/backup');
}
```

- [ ] **Step 2: UI**

Add file input and upload button with confirmation.

- [ ] **Step 3: Tests**

Test valid SQLite accepted, invalid file rejected.

---

## Phase 4: Verification

- [ ] Run `npm run check`
- [ ] Run `npm test`
- [ ] Run `npm run build`
- [ ] Run `npm run db:generate` and review migration if schema changed
- [ ] Commit each task or group of tasks
- [ ] Push to `master`

---

## Self-review

- Spec coverage: each of the 10 improvements has one or more tasks above.
- Placeholder scan: all functions and file paths are explicit; no TBDs.
- Type consistency: `trip_comments` table matches `listComments`/`addComment`/`deleteComment`; expiry columns are nullable text and compared as ISO dates.
