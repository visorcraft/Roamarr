# Roamarr Traveler-Focused Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Each feature below is implemented by a focused subagent with the full design spec and this plan.

**Goal:** Implement 10 traveler-focused improvements for families, groups, and solo travelers.

**Architecture:** Each feature is self-contained. Schema changes are bundled into one migration before subagents run. Each subagent owns specific route/server files and tests, avoiding file conflicts.

**Tech Stack:** SvelteKit 2, Svelte 5, TypeScript, Tailwind CSS v4, better-sqlite3, Drizzle ORM, Vitest, Luxon.

---

## Schema Preparation (done before subagents)

A single migration adds:
- `trips.status` text column with check constraint (`planning`, `booked`, `active`, `completed`), default `booked`.
- `trip_companions` table: `id`, `trip_id`, `name`, `category` (`adult`/`child`/`other`), `notes`, `created_at`.
- `trip_checklists` table: `id`, `trip_id`, `created_at`.
- `trip_checklist_items` table: `id`, `checklist_id`, `text`, `packed` boolean, `assigned_to_companion_id` nullable, `created_at`.
- `trip_expenses` table: `id`, `trip_id`, `description`, `amount` integer (cents), `currency` text, `paid_by_companion_id` nullable, `split_among` JSON array of companion IDs, `created_at`.
- `segment_attendees` table: `id`, `segment_id`, `companion_id`, `status` (`going`/`maybe`/`not_going`), `created_at`, unique on `(segment_id, companion_id)`.
- `emergency_contacts` table: `id`, `user_id`, `name`, `relationship`, `phone`, `email`, `is_primary` boolean, `created_at`.
- `trip_journal_entries` table: `id`, `trip_id`, `entry_date` text, `title`, `body`, `created_at`, `updated_at`.
- `trip_document_links` table: `id`, `trip_id`, `label`, `url`, `notes`, `created_at`.

Run `npm run db:generate` and review `drizzle/0015_*.sql`.

---

## Feature Decomposition

### Feature 1: Trip status lifecycle
**Subagent scope:** Add `trips.status` support.

**Files:**
- Modify: `src/routes/trips/[id]/edit/+page.server.ts` to accept `status`.
- Modify: `src/routes/trips/[id]/edit/+page.svelte` to add a status select.
- Modify: `src/routes/trips/+page.server.ts` to accept `status` filter.
- Modify: `src/routes/trips/+page.svelte` to render status filter buttons/chips and show status badges on trip cards.
- Test: `src/routes/trips/trips.test.ts` (add status filter test) and `src/routes/trips/[id]/edit/edit.test.ts`.

- [ ] Read existing trip edit and trips list files.
- [ ] Add status field to edit action and form.
- [ ] Add status filter to trips list load and UI.
- [ ] Add/update tests.
- [ ] Run `npm run check` and relevant tests.

### Feature 2: Trip companions
**Subagent scope:** CRUD companions on a trip.

**Files:**
- Create: `src/lib/server/tripCompanions.ts` and `tripCompanions.test.ts`.
- Modify: `src/routes/trips/[id]/+page.server.ts` actions for add/update/delete companion.
- Modify: `src/routes/trips/[id]/+page.svelte` to render companion list and forms.
- Test: route action tests under `src/routes/trips/[id]/`.

- [ ] Create server helper with CRUD and ownership checks.
- [ ] Add route actions.
- [ ] Render companion roster on trip detail.
- [ ] Add tests.
- [ ] Run `npm run check` and relevant tests.

### Feature 3: Packing checklist
**Subagent scope:** Per-trip checklist with items and assignees.

**Files:**
- Create: `src/lib/server/tripChecklists.ts` and `tripChecklists.test.ts`.
- Modify: `src/routes/trips/[id]/+page.server.ts` actions.
- Modify: `src/routes/trips/[id]/+page.svelte` to render checklist.
- Test: route action tests.

- [ ] Create server helper to load checklist with items and assigned companions.
- [ ] Add actions: add item, toggle packed, delete item.
- [ ] Render checklist UI with progress bar.
- [ ] Add tests.
- [ ] Run `npm run check` and relevant tests.

### Feature 4: Trip expense tracker
**Subagent scope:** Track expenses and compute splits.

**Files:**
- Create: `src/lib/server/tripExpenses.ts` and `tripExpenses.test.ts`.
- Modify: `src/routes/trips/[id]/+page.server.ts` actions.
- Modify: `src/routes/trips/[id]/+page.svelte` to render expense list and totals.
- Test: route action and math tests.

- [ ] Create server helper: add/delete expense, compute total and per-person share.
- [ ] Add route actions.
- [ ] Render expense list with total and currency.
- [ ] Add tests covering split math.
- [ ] Run `npm run check` and relevant tests.

### Feature 5: Duplicate segment
**Subagent scope:** Action to duplicate a segment within a trip.

**Files:**
- Modify: `src/lib/server/segments.ts` to add `duplicateSegment(userId, tripId, segId)`.
- Modify: `src/routes/trips/[id]/+page.server.ts` to add `?/duplicateSegment` action.
- Modify: `src/routes/trips/[id]/+page.svelte` to add duplicate button per segment.
- Test: `src/lib/server/segments.test.ts` and route action tests.

- [ ] Implement duplicate helper (copy fields, shift start/end by 24h, clear confirmation number).
- [ ] Wire action and UI.
- [ ] Add tests.
- [ ] Run `npm run check` and relevant tests.

### Feature 6: Segment attendees
**Subagent scope:** Track which companions are going to each segment.

**Files:**
- Create: `src/lib/server/segmentAttendees.ts` and `segmentAttendees.test.ts`.
- Modify: `src/routes/trips/[id]/+page.server.ts` actions.
- Modify: `src/routes/trips/[id]/+page.svelte` to render attendee chips/selector per segment.
- Test: route action tests.

- [ ] Create server helper to set attendee status and load per-segment attendees.
- [ ] Add action to toggle/set status.
- [ ] Render attendee status on each segment card.
- [ ] Add tests.
- [ ] Run `npm run check` and relevant tests.

### Feature 7: Emergency contacts
**Subagent scope:** User-level emergency contacts.

**Files:**
- Create: `src/lib/server/emergencyContacts.ts` and `emergencyContacts.test.ts`.
- Modify: `src/routes/profile/+page.server.ts` load and actions.
- Modify: `src/routes/profile/+page.svelte` to render emergency contact forms.
- Test: `src/routes/profile/profile.test.ts`.

- [ ] Create server helper with CRUD and ensure at most one primary contact.
- [ ] Add route actions.
- [ ] Render contact list with primary badge.
- [ ] Add tests.
- [ ] Run `npm run check` and relevant tests.

### Feature 8: Trip journal entries
**Subagent scope:** Daily journal notes per trip.

**Files:**
- Create: `src/lib/server/tripJournal.ts` and `tripJournal.test.ts`.
- Modify: `src/routes/trips/[id]/+page.server.ts` actions.
- Modify: `src/routes/trips/[id]/+page.svelte` to render journal entries section.
- Test: route action tests.

- [ ] Create server helper for CRUD.
- [ ] Add route actions.
- [ ] Render journal entries sorted by date.
- [ ] Add tests.
- [ ] Run `npm run check` and relevant tests.

### Feature 9: Trip document links
**Subagent scope:** Attach reservation URLs and notes to trips.

**Files:**
- Create: `src/lib/server/tripDocumentLinks.ts` and `tripDocumentLinks.test.ts`.
- Modify: `src/routes/trips/[id]/+page.server.ts` actions.
- Modify: `src/routes/trips/[id]/+page.svelte` to render document link list.
- Test: route action tests.

- [ ] Create server helper for CRUD.
- [ ] Add route actions.
- [ ] Render links with open/edit/delete.
- [ ] Add tests.
- [ ] Run `npm run check` and relevant tests.

### Feature 10: Printable itinerary
**Subagent scope:** Clean print view.

**Files:**
- Create: `src/routes/trips/[id]/print/+page.server.ts`, `src/routes/trips/[id]/print/+page.svelte`.
- Modify: `src/routes/trips/[id]/+page.svelte` to add a "Print" link.
- Test: `src/routes/trips/[id]/print/print.test.ts`.

- [ ] Create print route load that returns trip, segments grouped by day, and companions.
- [ ] Render compact, print-friendly itinerary.
- [ ] Add link from trip detail.
- [ ] Add load test.
- [ ] Run `npm run check` and relevant tests.

---

## Coordination Notes

- **Schema first:** The migration is generated before subagents start; subagents must not edit `schema.ts` or regenerate migrations.
- **Trip detail page conflicts:** Features 2, 3, 4, 6, 8, 9 all touch `src/routes/trips/[id]/+page.svelte` and `+page.server.ts`. To avoid conflicts, subagents should implement their server actions in separate helper modules and add minimal UI sections to the trip detail page. The parent agent will review and resolve any layout conflicts after subagents complete.
- **Companions dependency:** Features 3, 4, 6 use companions. They should read `trip_companions` via their own queries; do not depend on Feature 2's helper if that creates coupling.
- **No themes:** Do not add or modify themes.

---

## Verification

Run from repository root:

```bash
npm run check
npm test
npm run build
```

Expected: all commands succeed.

---

## Self-Review

- Spec coverage: all 10 features map to a task above.
- Placeholders: none; each task names exact files.
- Type consistency: table/column names match the schema preparation block.
