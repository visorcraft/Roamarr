# Ten More Roamarr Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ten small-to-medium v0.1 features to Roamarr: export, notification toggles, signed webhooks, full-text search, archive/favorite, custom reminders, audit filtering/pagination, session metadata, richer calendar feeds, and import dry-run.

**Architecture:** Each feature reuses existing server modules and routes. Schema changes are batched into one Drizzle migration, then independent features are built server-first with co-located Vitest tests, followed by thin route/UI changes.

**Tech Stack:** SvelteKit 2, Svelte 5, TypeScript strict, SQLite (`better-sqlite3`), Drizzle ORM, Luxon, Vitest.

---

## Pre-requisite: schema migration

Run after all schema edits:

```bash
npm run db:generate
npm run db:push
```

### Files to modify
- `src/lib/server/db/schema.ts`

### Changes
- `users` table: add `emailNotifications integer NOT NULL default true`, `webhookNotifications integer NOT NULL default true`.
- `trips` table: add `archived integer NOT NULL default false`, `favorite integer NOT NULL default false`.
- `sessions` table: add `lastIp text`, `userAgent text`.
- `reminders` table: extend `kind` check to include `'custom'`, extend `refType` check to include `'trip'`, and make `refId` nullable? No — keep `refId` integer and use `0` for trip-less? Simpler: allow `refType='trip'` and `refId=tripId`.

### Test impact
- Update `tests/helpers.ts` `makeUser` defaults if needed.
- Update any tests asserting exact user/trip/session rows.

---

## Feature 1: Trip export (JSON / CSV)

### Files
- Create: `src/lib/server/export.ts`, `src/routes/trips/export/+server.ts`, `src/lib/server/export.test.ts`
- Modify: `src/routes/trips/+page.svelte`

### Steps
- [ ] **Step 1:** Write `exportTrips(userId, format)` that selects owned trips and segments.
- [ ] **Step 2:** Implement JSON export as `{ trips: [...] }` matching import shape.
- [ ] **Step 3:** Implement CSV export with header row and one row per trip (flatten first segment if any).
- [ ] **Step 4:** Create `+server.ts` GET endpoint, returning `Content-Disposition: attachment`.
- [ ] **Step 5:** Add "Export" link to `/trips` next to Import.
- [ ] **Step 6:** Add tests verifying only owned trips export and CSV columns.
- [ ] **Step 7:** Run `npm test` and commit.

---

## Feature 2: Per-user notification channel toggles

### Files
- Modify: `src/lib/server/db/schema.ts` (above), `src/lib/server/notify.ts`, `src/routes/profile/+page.server.ts`, `src/routes/profile/+page.svelte`, `src/routes/profile/profile.test.ts`

### Steps
- [ ] **Step 1:** Update `notify.ts` `deliver()` to read recipient user row; skip SMTP if `emailNotifications=false`, skip webhook if `webhookNotifications=false`.
- [ ] **Step 2:** Add `emailNotifications` and `webhookNotifications` to profile load and `_updateProfile`.
- [ ] **Step 3:** Add two checkbox inputs to profile form.
- [ ] **Step 4:** Add tests that toggles suppress external channels but always create in-app notification.
- [ ] **Step 5:** Run `npm test` and commit.

---

## Feature 3: Signed outbound webhooks

### Files
- Modify: `src/lib/server/notify.ts`, `src/routes/settings/+page.svelte`, `src/lib/server/notify.test.ts`

### Steps
- [ ] **Step 1:** In webhook channel, compute HMAC-SHA256 of `"{timestamp}.{body}"` using `ROAMARR_SECRET`.
- [ ] **Step 2:** Add headers `X-Roamarr-Signature` and `X-Roamarr-Timestamp`.
- [ ] **Step 3:** Add a short verification hint on `/settings`.
- [ ] **Step 4:** Add test verifying signature round-trip.
- [ ] **Step 5:** Run `npm test` and commit.

---

## Feature 4: Full-text trip search across segments

### Files
- Modify: `src/lib/server/sharing.ts`, `src/routes/trips/+page.server.ts`, `src/routes/trips/+page.svelte`, `src/lib/server/sharing.test.ts`

### Steps
- [ ] **Step 1:** In `listViewableTrips`, when `q` is provided, for owned trips load matching segment titles/locations/confirmation numbers and include their trip IDs.
- [ ] **Step 2:** For shared trips, continue to search only trip `name`/`destination` unless `showDetails` granted.
- [ ] **Step 3:** Update search placeholder text on trips page.
- [ ] **Step 4:** Add tests for owner segment search and shared-trip scoping.
- [ ] **Step 5:** Run `npm test` and commit.

---

## Feature 5: Trip archive and favorite flags

### Files
- Modify: `src/lib/server/db/schema.ts` (above), `src/lib/server/sharing.ts`, `src/routes/trips/+page.server.ts`, `src/routes/trips/+page.svelte`, `src/routes/trips/[id]/+page.server.ts`, `src/routes/trips/[id]/+page.svelte`, tests

### Steps
- [ ] **Step 1:** Add `archived` and `favorite` to `listViewableTrips` options and filters.
- [ ] **Step 2:** Update `/trips` load to accept `filter` query param (`active`, `archived`, `favorites`).
- [ ] **Step 3:** Add tab UI and favorite star / archive bulk actions.
- [ ] **Step 4:** Add `?/toggleFavorite` and `?/toggleArchive` actions on trip detail.
- [ ] **Step 5:** Add tests for filter, bulk archive, and detail toggle.
- [ ] **Step 6:** Run `npm test` and commit.

---

## Feature 6: Custom reminders per segment / trip

### Files
- Modify: `src/lib/server/db/schema.ts` (above), `src/lib/server/reminders.ts`, `src/routes/trips/[id]/+page.server.ts`, `src/routes/trips/[id]/+page.svelte`, `src/routes/trips/[id]/segments/+page.server.ts`, tests

### Steps
- [ ] **Step 1:** Extend `reminders.kind` enum to `'custom'` and `refType` to `'trip'`.
- [ ] **Step 2:** Add `upsertCustomReminder(userId, { refType, refId, label, offsetMinutes })` that computes fireAt from referenced trip/segment start.
- [ ] **Step 3:** Add `messageFor` case for custom reminders with stored label in meta JSON.
- [ ] **Step 4:** Add small UI on trip detail and segment page to create a custom reminder.
- [ ] **Step 5:** Add tests for custom reminder fire time and message.
- [ ] **Step 6:** Run `npm test` and commit.

---

## Feature 7: Audit log filtering and pagination

### Files
- Modify: `src/lib/server/audit.ts`, `src/routes/settings/audit-logs/+page.server.ts`, `src/routes/settings/audit-logs/+page.svelte`, `src/lib/server/audit.test.ts`

### Steps
- [ ] **Step 1:** Extend `listAuditLogs` with optional filters (`userId`, `action`, `entityType`, `from`, `to`) and pagination (`limit`, `offset`).
- [ ] **Step 2:** Return total count for pagination UI.
- [ ] **Step 3:** Add filter form and previous/next buttons on audit page.
- [ ] **Step 4:** Add tests for filters and pagination.
- [ ] **Step 5:** Run `npm test` and commit.

---

## Feature 8: Session metadata (IP / user-agent)

### Files
- Modify: `src/lib/server/db/schema.ts` (above), `src/lib/server/auth.ts`, `src/hooks.server.ts`, `src/routes/profile/+page.server.ts`, `src/routes/profile/+page.svelte`, tests

### Steps
- [ ] **Step 1:** Add `lastIp` and `userAgent` columns to sessions.
- [ ] **Step 2:** Change `createSession(userId, ip?, ua?)` to store metadata.
- [ ] **Step 3:** In `hooks.server.ts`, capture `event.getClientAddress()` and `user-agent` after session resolution, update the session row (best-effort) or pass to creation on login.
- [ ] **Step 4:** Update login route to pass IP/UA to `createSession`.
- [ ] **Step 5:** Display IP and parsed UA in profile session list.
- [ ] **Step 6:** Add tests.
- [ ] **Step 7:** Run `npm test` and commit.

---

## Feature 9: Calendar feed support for all segment types + trip all-day event

### Files
- Modify: `src/lib/server/ical.ts`, `src/routes/trips/[id]/calendar/feed/+server.ts`, `src/lib/server/ical.test.ts`

### Steps
- [ ] **Step 1:** Update `CalendarSegment.type` to union of all `SEGMENT_TYPES`.
- [ ] **Step 2:** Map each segment type to a friendly event summary (e.g., "Car: ...", "Activity: ...").
- [ ] **Step 3:** Add a trip-bounds all-day VEVENT when `startDate` and `endDate` exist.
- [ ] **Step 4:** Update feed endpoint to pass all segments.
- [ ] **Step 5:** Add tests for non-flight/non-lodging segments and all-day event.
- [ ] **Step 6:** Run `npm test` and commit.

---

## Feature 10: Import dry-run / preview

### Files
- Modify: `src/lib/server/import.ts`, `src/routes/trips/import/+page.server.ts`, `src/routes/trips/import/+page.svelte`, `src/lib/server/import.test.ts`

### Steps
- [ ] **Step 1:** Add `dryRun` option to `importTrips()`; when true, run validation and return prospective trip/segment list without inserting.
- [ ] **Step 2:** Update import route action to support `dryRun` form field and return preview.
- [ ] **Step 3:** Update import page to show a "Preview" button and render preview rows, then a "Confirm import" button that re-submits with `dryRun=false`.
- [ ] **Step 4:** Add tests that dry-run produces no DB writes and returns same errors.
- [ ] **Step 5:** Run `npm test` and commit.

---

## Final verification

- [ ] Run `npm run check` — must report 0 errors.
- [ ] Run `npm test` — all tests must pass.
- [ ] Run `npm run build` — must succeed.
- [ ] Commit all changes and push to `master`.
