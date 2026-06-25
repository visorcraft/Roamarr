# Roamarr Traveler Features v2 Design

## Objective
Add ten shallow-but-functional features that families with kids, group travelers, and solo travelers would expect in a travel tracker. Keep the v0.1 walking-skeleton spirit: clear boundaries, minimal UI, tests, no theme work.

## Approach
**Recommended: parallel walking skeleton.** Implement all ten features as independent server modules with focused schema changes and trip-detail/profile UI wiring. Each feature gets its own module and tests; a small set of subagents can work in parallel. This keeps the same depth as the previous traveler-features batch and avoids blocking the whole set on any single item.

## Feature List

1. **Reusable packing checklist templates** — Save a trip checklist as a named template and apply it to a trip.
2. **Per-companion travel documents** — Link travel documents to trip companions (kids, partners) as well as the account owner.
3. **Companion dietary/allergy/medical notes** — Store health/allergy/dietary notes per companion for safer group planning.
4. **Expense balance settlement** — Compute net balances and minimum "who owes whom" payments from existing expense splits.
5. **Trip polls and voting** — Lightweight polls on a trip page with options and per-companion votes.
6. **Segment end timezone (`endTz`)** — Store/display segment end times in destination local time for flights/trains that cross zones.
7. **Segment status tracking** — Mark segments with states like `planned`, `checked_in`, `boarded`, `arrived`, `completed`.
8. **Segment meeting/rally point** — Add `meetingPoint` and optional `meetingAt` to segments for group coordination.
9. **Trip budget categories and alerts** — Set per-trip budget caps by category and warn when expenses approach/exceed them.
10. **Emergency-contact itinerary share** — Email the printable itinerary or a one-time public share link to saved emergency contacts.

## Schema Changes

### New tables
- `packing_templates(id, userId, name, isDefault, createdAt)`
- `packing_template_items(id, templateId, label, category)`
- `trip_polls(id, tripId, question, createdAt)`
- `trip_poll_options(id, pollId, label, sortOrder)`
- `trip_poll_votes(id, pollId, optionId, companionId, createdAt, unique(pollId, companionId))`
- `trip_budget_categories(id, tripId, category, amount, createdAt, unique(tripId, category))`

### Modified tables
- `travel_documents` — add nullable `companionId` FK to `trip_companions(id)`.
- `trip_companions` — add nullable text columns `dietary`, `allergies`, `medicalNotes`.
- `segments` — add `endTz` text, `status` text with check constraint (`planned`, `checked_in`, `boarded`, `arrived`, `completed`), `meetingPoint` text, `meetingAt` text.

## Server Modules

- `src/lib/server/packingTemplates.ts` — save template, apply template to trip, list templates.
- `src/lib/server/tripCompanions.ts` — extend CRUD with medical/dietary fields.
- `src/routes/profile/documents/+page.server.ts` / `+page.svelte` — extend travel-document CRUD to allow linking documents to a companion.
- `src/lib/server/tripExpenses.ts` — add settlement calculation.
- `src/lib/server/tripPolls.ts` — create poll, cast vote, tally results.
- `src/lib/server/segments.ts` — extend segment forms/parsing with `endTz`, `status`, `meetingPoint`, `meetingAt`.
- `src/lib/server/tripBudgets.ts` — set category budgets and compute remaining/alerts.
- `src/lib/server/emergencyContacts.ts` — add share-itinerary helper that emails contacts.

## UI/Route Changes

- `src/routes/trips/[id]/+page.server.ts` / `+page.svelte` — load and wire all new data and actions.
- `src/routes/profile/+page.svelte` / `+page.server.ts` — companion documents, emergency-contact share from profile (optional; main share lives on trip page).
- `src/routes/trips/[id]/print/+page.svelte` — show `endTz`, status, meeting point if present.
- Segment form shells — add optional `endTz`, `status`, `meetingPoint`, `meetingAt` fields where relevant.

## Security & Invariants
- Companion documents follow the same encryption rule as owner documents if `number` is stored encrypted; no full PANs.
- Poll votes are per-companion and only editable by trip editors.
- Segment status is viewable by anyone who can view the trip; mutable by editors.
- Budget alerts are read-only computations; budgets mutable by editors.
- Emergency-contact share must rate-limit and log audit.

## Testing
- Co-located `.test.ts` for each new server module covering happy path and auth/authorization.
- Update `trip-detail.test.ts` and `segments.test.ts` for new fields/actions.
- Run `npm run check`, `npm test`, `npm run build` before commit.
