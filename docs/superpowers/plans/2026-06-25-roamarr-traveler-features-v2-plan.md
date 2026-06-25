# Roamarr Traveler Features v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement the feature tasks in parallel, then integrate and verify.

**Goal:** Implement ten shallow walking-skeleton features for families, groups, and solo travelers in Roamarr.

**Architecture:** Each feature gets a focused server module, schema changes, and trip-detail/profile UI wiring. Independent features run in parallel subagents; the parent agent resolves shared schema migration order and final integration into `src/routes/trips/[id]/+page.server.ts` / `+page.svelte`.

**Tech Stack:** SvelteKit 2 / Svelte 5, TypeScript, Drizzle ORM, SQLite, better-sqlite3, Luxon, Vitest.

---

## File map

- `src/lib/server/db/schema.ts` — add all new tables/columns.
- `drizzle/` — generate migration `0016_*.sql` after schema edits.
- `src/lib/server/packingTemplates.ts` + `.test.ts` — save/apply/list templates.
- `src/lib/server/tripCompanions.ts` + `.test.ts` — extend companion CRUD with dietary/allergy/medical notes.
- `src/routes/profile/documents/+page.server.ts` / `+page.svelte` — companion-aware document CRUD.
- `src/lib/server/tripExpenses.ts` + `.test.ts` — add settlement balance calculation.
- `src/lib/server/tripPolls.ts` + `.test.ts` — polls, options, votes.
- `src/lib/server/segments.ts` + `.test.ts` — add `endTz`, `status`, `meetingPoint`, `meetingAt`.
- `src/lib/server/tripBudgets.ts` + `.test.ts` — budget categories and alerts.
- `src/lib/server/emergencyContacts.ts` + `.test.ts` — email itinerary to contact.
- `src/routes/trips/[id]/+page.server.ts` / `+page.svelte` — load and wire all new data/actions.
- `src/routes/trips/[id]/print/+page.svelte` — display new segment fields.
- Segment form shells under `src/lib/components/segments/` — add new optional fields where relevant.

---

## Task 1: Schema migration

**Files:**
- Modify: `src/lib/server/db/schema.ts`
- Create: `drizzle/0016_*.sql`, `drizzle/meta/0016_snapshot.json`

- [ ] **Step 1: Add new tables**
  - `packing_templates`, `packing_template_items`
  - `trip_polls`, `trip_poll_options`, `trip_poll_votes`
  - `trip_budget_categories`
- [ ] **Step 2: Add columns**
  - `travel_documents.companionId` nullable FK → `trip_companions(id)`
  - `trip_companions.dietary`, `trip_companions.allergies`, `trip_companions.medicalNotes` nullable text
  - `segments.endTz`, `segments.status` with check constraint, `segments.meetingPoint`, `segments.meetingAt`
- [ ] **Step 3: Generate migration**
  Run: `npm run db:generate`
  Expected: creates `drizzle/0016_*.sql` and `drizzle/meta/0016_snapshot.json` without errors.
- [ ] **Step 4: Commit**
  ```bash
  git add src/lib/server/db/schema.ts drizzle/
  git commit -m "schema: add v2 traveler feature tables and columns"
  ```

---

## Task 2: Reusable packing checklist templates

**Files:**
- Create: `src/lib/server/packingTemplates.ts`, `src/lib/server/packingTemplates.test.ts`
- Modify: `src/routes/trips/[id]/+page.server.ts`, `src/routes/trips/[id]/+page.svelte`

- [ ] **Step 1: Write server module**
  Implement `saveTemplate(userId, name, itemLabels[], fromTripId?)`, `listTemplates(userId)`, `applyTemplate(templateId, tripId, userId)`.
- [ ] **Step 2: Write tests**
  Test save, list, apply, ownership guard.
- [ ] **Step 3: Wire UI**
  Add "Save as template" and "Apply template" controls to the existing packing checklist card.
- [ ] **Step 4: Run tests**
  Run: `npm test -- src/lib/server/packingTemplates.test.ts`
  Expected: all pass.
- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/server/packingTemplates.ts src/lib/server/packingTemplates.test.ts src/routes/trips/[id]/+page.server.ts src/routes/trips/[id]/+page.svelte
  git commit -m "feat: reusable packing checklist templates"
  ```

---

## Task 3: Per-companion travel documents

**Files:**
- Modify: `src/lib/server/db/schema.ts` (already in Task 1), `src/routes/profile/documents/+page.server.ts`, `src/routes/profile/documents/+page.svelte`, `src/routes/profile/documents/documents.test.ts`

- [ ] **Step 1: Extend document CRUD**
  Add optional `companionId` to create/update forms and DB writes; list owner documents and companion documents separately.
- [ ] **Step 2: Update tests**
  Test creating a document linked to a companion and that companion documents are listed.
- [ ] **Step 3: Update UI**
  Add companion selector to the document form; show companion name on document rows.
- [ ] **Step 4: Run tests**
  Run: `npm test -- src/routes/profile/documents/documents.test.ts`
  Expected: all pass.
- [ ] **Step 5: Commit**
  ```bash
  git add src/routes/profile/documents/ src/lib/server/db/schema.ts
  git commit -m "feat: per-companion travel documents"
  ```

---

## Task 4: Companion dietary, allergy, and medical notes

**Files:**
- Modify: `src/lib/server/tripCompanions.ts`, `src/lib/server/tripCompanions.test.ts`, `src/routes/trips/[id]/+page.server.ts`, `src/routes/trips/[id]/+page.svelte`

- [ ] **Step 1: Extend companion CRUD**
  Add `dietary`, `allergies`, `medicalNotes` to validation and DB writes.
- [ ] **Step 2: Update tests**
  Test update with notes and validation (max length).
- [ ] **Step 3: Update UI**
  Add collapsible notes form in the Travelers card.
- [ ] **Step 4: Run tests**
  Run: `npm test -- src/lib/server/tripCompanions.test.ts`
  Expected: all pass.
- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/server/tripCompanions.ts src/lib/server/tripCompanions.test.ts src/routes/trips/[id]/+page.server.ts src/routes/trips/[id]/+page.svelte
  git commit -m "feat: companion dietary, allergy, and medical notes"
  ```

---

## Task 5: Expense balance settlement

**Files:**
- Modify: `src/lib/server/tripExpenses.ts`, `src/lib/server/tripExpenses.test.ts`, `src/routes/trips/[id]/+page.server.ts`, `src/routes/trips/[id]/+page.svelte`

- [ ] **Step 1: Add settlement function**
  Implement `computeSettlement(expenses, companions)` returning net balances and minimum payments.
- [ ] **Step 2: Update tests**
  Test equal split, uneven split, and single person.
- [ ] **Step 3: Update UI**
  Show "Balances" and "Suggested payments" in the Expenses section.
- [ ] **Step 4: Run tests**
  Run: `npm test -- src/lib/server/tripExpenses.test.ts`
  Expected: all pass.
- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/server/tripExpenses.ts src/lib/server/tripExpenses.test.ts src/routes/trips/[id]/+page.server.ts src/routes/trips/[id]/+page.svelte
  git commit -m "feat: expense balance settlement"
  ```

---

## Task 6: Trip polls and voting

**Files:**
- Create: `src/lib/server/tripPolls.ts`, `src/lib/server/tripPolls.test.ts`
- Modify: `src/routes/trips/[id]/+page.server.ts`, `src/routes/trips/[id]/+page.svelte`

- [ ] **Step 1: Write server module**
  Implement `createPoll(tripId, question, options[])`, `vote(pollId, companionId, optionId)`, `deletePoll(pollId)`, `listPollsWithVotes(tripId)`.
- [ ] **Step 2: Write tests**
  Test creation, voting, changing vote, ownership guards.
- [ ] **Step 3: Wire UI**
  Add Polls section to trip detail; show vote counts and allow casting/editing votes.
- [ ] **Step 4: Run tests**
  Run: `npm test -- src/lib/server/tripPolls.test.ts`
  Expected: all pass.
- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/server/tripPolls.ts src/lib/server/tripPolls.test.ts src/routes/trips/[id]/+page.server.ts src/routes/trips/[id]/+page.svelte
  git commit -m "feat: trip polls and voting"
  ```

---

## Task 7: Segment end timezone

**Files:**
- Modify: `src/lib/server/segments.ts`, `src/lib/server/segments.test.ts`, segment form shells in `src/lib/components/segments/`, `src/routes/trips/[id]/segments/new/*/+page.svelte`, `src/routes/trips/[id]/+page.svelte`, `src/routes/trips/[id]/print/+page.svelte`

- [ ] **Step 1: Extend segment parsing/storage**
  Add `endTz` optional field; default to `startTz` if absent.
- [ ] **Step 2: Update display helpers**
  Use `endTz` when formatting segment end datetime in timeline and print views.
- [ ] **Step 3: Update tests**
  Test segment creation with `endTz` and default behavior.
- [ ] **Step 4: Run tests**
  Run: `npm test -- src/lib/server/segments.test.ts`
  Expected: all pass.
- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/server/segments.ts src/lib/server/segments.test.ts src/lib/components/segments/ src/routes/trips/[id]/+page.svelte src/routes/trips/[id]/print/+page.svelte src/routes/trips/[id]/segments/
  git commit -m "feat: segment end timezone"
  ```

---

## Task 8: Segment status tracking

**Files:**
- Modify: `src/lib/server/segments.ts`, `src/lib/server/segments.test.ts`, `src/routes/trips/[id]/+page.server.ts`, `src/routes/trips/[id]/+page.svelte`

- [ ] **Step 1: Add status enum handling**
  Add `status` optional field with values `planned`, `checked_in`, `boarded`, `arrived`, `completed`.
- [ ] **Step 2: Add quick-status action**
  Add action `?/setSegmentStatus` on trip detail page.
- [ ] **Step 3: Update tests**
  Test status update and invalid status rejection.
- [ ] **Step 4: Update UI**
  Show status badge and small status selector on each segment card (editor only).
- [ ] **Step 5: Run tests**
  Run: `npm test -- src/lib/server/segments.test.ts src/routes/trips/[id]/trip-detail.test.ts`
  Expected: all pass.
- [ ] **Step 6: Commit**
  ```bash
  git add src/lib/server/segments.ts src/lib/server/segments.test.ts src/routes/trips/[id]/+page.server.ts src/routes/trips/[id]/+page.svelte
  git commit -m "feat: segment status tracking"
  ```

---

## Task 9: Segment meeting/rally point

**Files:**
- Modify: `src/lib/server/segments.ts`, `src/lib/server/segments.test.ts`, segment form shells, `src/routes/trips/[id]/+page.svelte`, `src/routes/trips/[id]/print/+page.svelte`

- [ ] **Step 1: Add fields**
  Add optional `meetingPoint` (text) and `meetingAt` (datetime) to segment forms and storage.
- [ ] **Step 2: Update tests**
  Test create/update with meeting info.
- [ ] **Step 3: Update UI**
  Display meeting point/time on segment cards and print view.
- [ ] **Step 4: Run tests**
  Run: `npm test -- src/lib/server/segments.test.ts`
  Expected: all pass.
- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/server/segments.ts src/lib/server/segments.test.ts src/lib/components/segments/ src/routes/trips/[id]/+page.svelte src/routes/trips/[id]/print/+page.svelte
  git commit -m "feat: segment meeting and rally point"
  ```

---

## Task 10: Trip budget categories and alerts

**Files:**
- Create: `src/lib/server/tripBudgets.ts`, `src/lib/server/tripBudgets.test.ts`
- Modify: `src/routes/trips/[id]/+page.server.ts`, `src/routes/trips/[id]/+page.svelte`

- [ ] **Step 1: Write server module**
  Implement `setBudget(tripId, category, amount)`, `deleteBudget(tripId, category)`, `listBudgetsWithSpent(tripId, expenses)` returning spent and remaining.
- [ ] **Step 2: Write tests**
  Test CRUD and alert computation (over/under budget).
- [ ] **Step 3: Wire UI**
  Add Budget section to trip detail with category caps and progress bars/alerts.
- [ ] **Step 4: Run tests**
  Run: `npm test -- src/lib/server/tripBudgets.test.ts`
  Expected: all pass.
- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/server/tripBudgets.ts src/lib/server/tripBudgets.test.ts src/routes/trips/[id]/+page.server.ts src/routes/trips/[id]/+page.svelte
  git commit -m "feat: trip budget categories and alerts"
  ```

---

## Task 11: Emergency-contact itinerary share

**Files:**
- Modify: `src/lib/server/emergencyContacts.ts`, `src/lib/server/emergencyContacts.test.ts`, `src/routes/trips/[id]/+page.server.ts`, `src/routes/trips/[id]/+page.svelte`

- [ ] **Step 1: Add share helper**
  Implement `shareItineraryWithContact(userId, tripId, contactId, origin)` that emails the contact a link to the printable itinerary (or public share link if enabled) and logs an audit event.
- [ ] **Step 2: Update tests**
  Test happy path, contact ownership guard, and rate-limiting.
- [ ] **Step 3: Wire UI**
  Add "Email itinerary to emergency contact" button on trip detail (editor only).
- [ ] **Step 4: Run tests**
  Run: `npm test -- src/lib/server/emergencyContacts.test.ts`
  Expected: all pass.
- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/server/emergencyContacts.ts src/lib/server/emergencyContacts.test.ts src/routes/trips/[id]/+page.server.ts src/routes/trips/[id]/+page.svelte
  git commit -m "feat: emergency-contact itinerary share"
  ```

---

## Task 12: Final integration and verification

- [ ] **Step 1: Regenerate migrations if needed**
  Run: `npm run db:generate` after all schema edits; review generated SQL.
- [ ] **Step 2: Run Svelte/TypeScript check**
  Run: `npm run check`
  Expected: 0 errors, 0 warnings.
- [ ] **Step 3: Run full test suite**
  Run: `npm test`
  Expected: all tests pass.
- [ ] **Step 4: Run production build**
  Run: `npm run build`
  Expected: build succeeds.
- [ ] **Step 5: Squash/review commits and push**
  Run:
  ```bash
  git log --oneline -20
  git push origin master
  ```
