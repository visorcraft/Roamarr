# Database Seeder Design

## Goal

Provide a single, maintainable seeder that rebuilds a rich demo account in the local Roamarr database. The target email and password are supplied at runtime (CLI argument or environment variable) so no personal email is committed. The seeder must be date-aware so it stays relevant whenever it is rerun, and it must cover the full surface of entities the user wants to see in the UI.

## Scope

- Create/replace a target demo account (email supplied at runtime) and all of its data.
- Seed global profile data: travel documents, payment cards (with benefits), insurance policies, loyalty programs, emergency contacts, visited countries and U.S. states.
- Seed groups with members.
- Seed trips spanning past dates, future 2027 dates, and a "payment due soon" trip.
- For each trip seed: segments, companions, expenses, budgets, checklist items, journal entries, document links, reminders, and fare watches.
- Seed notifications/alerts (in-app notifications plus budget-expense combinations that trigger computed budget alerts).
- Fix the sidebar so any navigation item with children defaults to collapsed.

## Out of scope

- Changing release-container data. This only touches the local dev container database.
- Seeding UI-only state such as theme or sidebar expansion.

## Approach

A single `DatabaseSeeder` class in `src/lib/server/seedDatabase.ts` that uses the existing server repositories and helpers. The class accepts `email`, `password`, and an optional `now` date in its constructor:

- `usersRepo`, `tripsRepo`, `segmentsRepo`, `profileRepo`, `remindersRepo`
- `tripCompanions.insertTripCompanion`
- `tripExpenses/repository.addTripExpense`
- `tripBudgets.setTripBudget`
- `tripChecklists.addItem`
- `tripJournal.createJournalEntry`
- `tripDocumentLinks.createDocumentLink`
- `visitedPlaces.markCountryVisited`, `markStateVisited`
- `fareproviders.createProvider`, `toggleWatch`

The class is synchronous except for hashing the account password.

### Date math

A small helper uses `luxon` (already a project dependency) and a configurable `now` date to derive:

- Past trips: one in the previous year and one earlier in the current year.
- Future trips: three trips in the next calendar year (e.g., 2027 right now).
- Payment-due-soon trip: a trip with a segment whose `payment_due_date` is ~14 days after `now`.
- Documents expiring in August of the current year (or next year if `now` is already August or later).
- Additional documents expiring ~60 days after `now` so reminder/alert logic has something to surface.
- Reminders fire slightly in the future.

### Wipe-and-rebuild behavior

`seeder.run()` will:

1. Look up the configured target email.
2. If found, delete all rows owned by that user in a safe order (children before parents, using direct `kit` deletes where repositories do not provide delete helpers).
3. Create the user with the supplied password.
4. Seed all entities in dependency order.

### Runner

`scripts/seed-database.mjs` registers a tiny Node module-resolution hook (`scripts/seed-alias-loader.mjs`) that maps SvelteKit's `$lib/` alias to `./src/lib/`. It then imports `DatabaseSeeder`, ensures `ROAMARR_SECRET` is present, reads the target email/password from CLI arguments or environment variables (`SEED_EMAIL`, `SEED_PASSWORD`), and calls `await seeder.run()`.

`package.json` gets a new script:

```json
"db:seed": "node scripts/seed-database.mjs"
```

Run with:

```sh
export ROAMARR_SECRET="..."
export SEED_EMAIL="user@example.com"
export SEED_PASSWORD="your-secure-password"
rtk npm run db:seed
```

Or pass them as CLI arguments:

```sh
rtk npm run db:seed -- --email user@example.com --password 'your-secure-password'
```

### Sidebar fix

`src/routes/+layout.svelte` currently renders child links for any `NavItem` with `children` unconditionally. We will:

- Add `expandedItems: Record<string, boolean>` state, defaulting to `{}`.
- Provide `isItemExpanded(label)` (returns `expandedItems[label] ?? false`) and `toggleItem(label)`.
- Persist the state to `localStorage` under `roamarr.sidebar.items`.
- Wrap the child link list in `{#if isItemExpanded(item.label)}` and add a small chevron button next to items that have children.
- Expand an item automatically when one of its children is the active route, mirroring the existing section behavior.

Only `Visited` currently has children, so the change is immediately visible.

### Testing

- `src/lib/server/seedDatabase.test.ts` mocks the DB with `freshDb()` from `tests/helpers.ts`, uses a fixed `now`, calls `seeder.run()`, and asserts counts for users, trips, segments, cards, documents, groups, visited places, fare watches, and reminders.
- After implementation, run `rtk npm run check` and the new test.
- Run the seeder against the dev container and verify the populated data through the UI.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Deleting user data beyond the target account | Only delete rows whose `user_id` matches the resolved target user. |
| Foreign-key failures during cleanup | Delete children before parents; use `executeSync()` and rely on `ON DELETE CASCADE` where present. |
| `$lib/` alias resolution in runner | Test the alias loader with the actual seeder import before claiming it works. |
| Sidebar localStorage state hides active children | Auto-expand the active item's parent on route change. |
