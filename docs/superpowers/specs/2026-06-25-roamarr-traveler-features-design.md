# Roamarr Traveler-Focused Improvements Design

Date: 2026-06-25

## Goal

Implement 10 new features that make Roamarr more useful for families with kids, people traveling in groups, and solo travelers. No new themes or theme changes.

## Selected Improvements

### 1. Trip status lifecycle
**Problem:** Trips are only `archived`/`favorite`; there is no planning progress state.  
**Solution:** Add `trips.status` with values `planning`, `booked`, `active`, `completed`. Default existing trips to `booked`. Allow editing on the trip edit page and filtering on the trips list.  
**Schema:** `trips.status` text with check constraint.  
**Files:** `src/lib/server/db/schema.ts`, `src/routes/trips/+page.server.ts`, `src/routes/trips/+page.svelte`, `src/routes/trips/[id]/edit/+page.server.ts`, `src/routes/trips/[id]/edit/+page.svelte`.  
**Tests:** Status filter tests, edit action test.

### 2. Trip companions
**Problem:** There is no roster of who is actually on a trip.  
**Solution:** Add a `trip_companions` table with `name`, `category` (`adult`, `child`, `other`), and `notes`. Manage companions from the trip detail page.  
**Schema:** `trip_companions` table.  
**Files:** `src/lib/server/db/schema.ts`, new server helper, `src/routes/trips/[id]/+page.server.ts`, `src/routes/trips/[id]/+page.svelte`.  
**Tests:** CRUD tests.

### 3. Packing checklist
**Problem:** No shared packing/task list for a trip.  
**Solution:** Add `trip_checklists` and `trip_checklist_items` tables. One checklist per trip; items have text, `packed` boolean, and optional `assignedTo` companion. Render on trip detail page.  
**Schema:** `trip_checklists`, `trip_checklist_items` tables.  
**Files:** Server helper, route actions, `src/routes/trips/[id]/+page.svelte`.  
**Tests:** Add/toggle/delete item tests.

### 4. Trip expense tracker
**Problem:** No cost tracking or expense splitting for group trips.  
**Solution:** Add `trip_expenses` table with `description`, `amount` (cents integer), `currency`, `paidByCompanionId` (or null for owner), and `splitAmong` JSON array of companion IDs. Show total spend and per-person share on the trip page.  
**Schema:** `trip_expenses` table.  
**Files:** Server helper, route actions, `src/routes/trips/[id]/+page.svelte`.  
**Tests:** Add/expense math tests.

### 5. Duplicate segment
**Problem:** Recurring segments (shuttles, daily activities) must be re-entered manually.  
**Solution:** Add a "Duplicate" action on each segment in the trip timeline that creates a copy with the same type, title, times shifted by 24 hours, location, confirmation number, and details.  
**Schema:** None.  
**Files:** `src/lib/server/segments.ts`, `src/routes/trips/[id]/+page.server.ts`, `src/routes/trips/[id]/+page.svelte`.  
**Tests:** Duplicate action test.

### 6. Segment attendees
**Problem:** Group trips need to track who is going to each segment.  
**Solution:** Add `segment_attendees` table linking companions to segments with status `going`, `maybe`, `not_going`. Show attendee chips on each segment and allow the trip owner to set status.  
**Schema:** `segment_attendees` table.  
**Files:** Server helper, route actions, segment rendering in trip detail.  
**Tests:** Status update/visibility tests.

### 7. Emergency contacts
**Problem:** Solo travelers and families have no place to store emergency contacts.  
**Solution:** Add `emergency_contacts` table per user with `name`, `relationship`, `phone`, `email`, and `isPrimary`. Manage from `/profile`.  
**Schema:** `emergency_contacts` table.  
**Files:** Server helper, `src/routes/profile/+page.server.ts`, `src/routes/profile/+page.svelte`.  
**Tests:** CRUD tests.

### 8. Trip journal entries
**Problem:** Travelers want to keep daily notes/memories without editing trip notes as one block.  
**Solution:** Add `trip_journal_entries` table with `entryDate`, `title`, `body`. Render as a journal tab/section on the trip detail page.  
**Schema:** `trip_journal_entries` table.  
**Files:** Server helper, route actions, `src/routes/trips/[id]/+page.svelte`.  
**Tests:** CRUD tests.

### 9. Trip document links
**Problem:** Travel documents are user-level; reservations, tickets, and URLs are not linked to trips.  
**Solution:** Add `trip_document_links` table with `label`, `url`, `notes`. Manage on trip detail page.  
**Schema:** `trip_document_links` table.  
**Files:** Server helper, route actions, `src/routes/trips/[id]/+page.svelte`.  
**Tests:** CRUD tests.

### 10. Printable itinerary
**Problem:** There is no clean, printer-friendly view of a trip.  
**Solution:** Add `/trips/[id]/print` route that renders a compact, plain itinerary with trip header, day-grouped segments, and companion roster. Hide editing UI.  
**Schema:** None.  
**Files:** `src/routes/trips/[id]/print/+page.server.ts`, `src/routes/trips/[id]/print/+page.svelte`.  
**Tests:** Load test verifying print view renders segments.

## Cross-cutting Constraints

- All features respect existing auth/sharing: only owners/editors can mutate; viewers see read-only data.
- Schema changes require `npm run db:generate`, reviewed migration, and tests.
- Use existing app classes and CSS variables; no theme changes.
- Security-relevant mutations call `logAudit`.
- Keep route files thin; put business logic in `src/lib/server/`.

## Out of Scope

- Real-time collaborative editing.
- Currency conversion.
- File uploads (links only).
- Push notifications.
- Themes or visual style changes.

## Verification

- `npm run check` passes.
- `npm test` passes.
- New features have focused tests.
