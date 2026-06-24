# Roamarr — 10 v0.1 Walking-Skeleton Improvements

**Status:** design ready for implementation  
**Date:** 2026-06-24

This spec tightens existing seams rather than introducing new subsystems. Every item is small-to-medium, fits the current SQLite/Drizzle/SvelteKit stack, and must be covered by co-located Vitest tests.

---

## 1. Custom reminder list & cancellation

**Goal:** Users can see their pending/sent reminders and cancel any pending one.

**Changes:**
- `src/lib/server/reminders.ts`: add `listRemindersForUser(userId)` returning reminders ordered by `fireAt desc`; add `cancelReminder(userId, reminderId)` that verifies ownership and deletes the row.
- `src/routes/profile/reminders/+page.server.ts`: load the list; add `cancel` action.
- `src/routes/profile/reminders/+page.svelte`: list reminders with title, fire-at, status, and a cancel button for pending rows.
- `src/routes/+layout.svelte`: add a "Reminders" link under Profile.

**Tests:** `src/lib/server/reminders.test.ts` for helpers; route test for listing/cancellation and ownership guard.

---

## 2. Clean up trip-level reminders on trip delete

**Goal:** Deleting a trip also removes any `ref_type='trip'` custom reminders.

**Changes:**
- `src/routes/trips/+page.server.ts` (`delete` action) and `src/routes/trips/[id]/edit/+page.server.ts` (`_deleteTrip`): after segment cleanup call `cancelRemindersFor('trip', tripId)`.

**Tests:** `trips.test.ts` and `trip-detail.test.ts` assert no `reminders` rows remain with `ref_type='trip'` after deletion.

---

## 3. Respect per-user document expiry lead on dashboard

**Goal:** The dashboard "Documents expiring soon" window uses the user's configured `documentExpiryLeadDays`.

**Changes:**
- `src/routes/+page.server.ts`: replace the hardcoded `plus({ days: 120 })` with `plus({ days: u.documentExpiryLeadDays })`.

**Tests:** `dashboard.test.ts` with a user whose lead is 30 days and a document 60 days out (should not appear).

---

## 4. Reminder notification copy matches configured leads

**Goal:** Notification bodies no longer hardcode "24 hours" / "90 days".

**Changes:**
- `src/lib/server/reminders.ts` `messageFor`: use generic copy that does not mention fixed intervals:
  - Flight check-in: "A flight you track is departing soon."
  - Document expiry: "A travel document is expiring soon."
  - Custom: preserve existing link.
- Update any tests asserting the old strings.

**Tests:** `reminders.test.ts` asserts the generic wording and correct deep links.

---

## 5. Round-trip CSV export/import

**Goal:** CSV export emits one row per segment and CSV import reconstructs multi-segment trips without data loss.

**Changes:**
- `src/lib/server/export.ts`: build CSV rows keyed by `(trip_id, segment_id)`; include a `segment_id` column so re-import can group rows.
- `src/lib/server/import.ts`: when parsing CSV, group rows by `trip_id` (or synthetic key from name+start_date if absent), create the trip once, then create one segment per row.
- Keep JSON export/import unchanged.

**Tests:** `export.test.ts` and `import.test.ts` verify a multi-segment trip survives export → import and segment count is preserved.

---

## 6. Groups I belong to + share with member groups

**Goal:** Users can see groups they are members of and share trips into those groups.

**Changes:**
- `src/lib/server/sharing.ts`: add `listGroupsForUser(userId)` returning groups the user owns or belongs to.
- `src/routes/groups/+page.server.ts`: load owned groups plus memberships.
- `src/routes/trips/[id]/share/+page.server.ts`: load the same list into the share form.
- Adjust share action ownership check: allow sharing into any group returned by `listGroupsForUser`.

**Tests:** `groups.test.ts` / `sharing-routes.test.ts` for member visibility and non-owner sharing.

---

## 7. Fare-watch change alerts

**Goal:** Notify the user when a fare-provider check returns a different summary than the previous check.

**Changes:**
- `src/lib/server/fareproviders/index.ts`: in `runFareChecks`, before storing `lastResultJson`, compare the new `summary` with the old. If it changed (and the watch is not brand-new), call `notify.deliver(userId, { title: 'Fare watch update', body, link: '/trips' })`.
- Keep provider-agnostic: compare only `summary` strings.

**Tests:** `fareproviders.test.ts` mocks `notify.deliver` and asserts a notification is sent only on summary change.

---

## 8. Attach/detach insurance policies from trip detail

**Goal:** On a trip detail page, an owner/editor can attach or detach one of their existing insurance policies.

**Changes:**
- `src/lib/server/insurance.ts` (new small module): `listPoliciesForUser(userId)`, `attachPolicyToTrip(userId, policyId, tripId)`, `detachPolicyFromTrip(userId, policyId)` — all ownership-checked.
- `src/routes/trips/[id]/+page.server.ts`: load user's unattached policies; add `attachPolicy` / `detachPolicy` actions.
- `src/routes/trips/[id]/+page.svelte`: sidebar insurance card gets a `<select>` + attach button and a detach button per linked policy.

**Tests:** `trip-detail.test.ts` and new `insurance.test.ts` for attach/detach ownership.

---

## 9. Recent audit activity on admin dashboard

**Goal:** `/settings` shows the last 5–10 security events for admins.

**Changes:**
- `src/routes/settings/+page.server.ts`: load `listAuditLogs({ limit: 10 })` (admin only; reuse `requireAdmin`).
- `src/routes/settings/+page.svelte`: render a compact list of recent actions with actor, action, entity, and timestamp.

**Tests:** `settings.test.ts` asserts recent audit events appear for admins and are omitted/non-rendered for non-admins.

---

## 10. Rate-limit public share & calendar feed endpoints

**Goal:** Public `/share/[token]` and `/trips/[id]/calendar/feed` endpoints are throttled per IP.

**Changes:**
- `src/routes/share/[token]/+page.server.ts`: apply `checkRateLimit` with a public-endpoint key (e.g., `share:${event.getClientAddress()}`) and return 429 if exceeded.
- `src/routes/trips/[id]/calendar/feed/+server.ts`: same for `calendar:${event.getClientAddress()}`.
- `src/lib/server/rateLimit.ts`: ensure public endpoints use an appropriate window/cap (e.g., 100 requests per minute).

**Tests:** `share.test.ts` and `feed.test.ts` assert 429 after exceeding the limit and normal 200 before.

---

## Cross-cutting constraints

- All new mutations must run through existing `ownership.ts` / `requireUser` guards.
- Encrypted fields (`travel_documents.number`, etc.) keep existing AES-GCM handling.
- Viewer projection rules stay unchanged: shared/public views continue to omit private fields.
- All changes require migrations only if schema changes; this spec introduces no schema changes.
