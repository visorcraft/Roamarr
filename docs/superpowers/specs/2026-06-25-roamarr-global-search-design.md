# Global Trip Search

## Goal
Wire the existing top-bar search input to a new `/search` page that instantly
lists matching trips, using the same card style as `/trips`.

## Decisions from brainstorming

- **Search scope:** trip name, destination, tags, and segment
  title/location/confirmation number. This matches the existing `/trips?q=...`
  behavior implemented in `listViewableTrips`.
- **Empty-query state:** show an empty state prompting the user to type.
  Do not list all trips when no query is present.
- **Navigation model:** debounced `goto('/search?q=...')` from the top bar.
  Server-side load runs the search; client-side navigation makes it feel
  instant.
- **Keyboard shortcut:** pressing `/` anywhere in the app focuses the top
  search input, unless the user is already typing in an input/textarea.
- **Result cards:** reuse the existing `/trips` card styling. No bulk-action
  checkboxes on the search page.
- **Filter baseline:** search uses `filter: 'active'` by default, identical to
  `/trips`. Archived trips are excluded from results.

## Architecture

```text
+layout.svelte
  └── top-bar search input
        └── oninput debounce 300ms
              └── goto('/search?q=<query>')

/search/+page.server.ts
  └── listViewableTrips(userId, { q, filter: 'active' })
        └── returns trips + q

/search/+page.svelte
  └── "Search Results" heading
        └── TripCard grid or EmptyState

TripCard.svelte (new shared component)
  └── extracted from /trips card markup
```

## Files to change / create

- `src/routes/+layout.svelte` — add debounce, `/` shortcut, and wire the
  search input to navigate to `/search`.
- `src/lib/components/TripCard.svelte` — new shared card component.
- `src/routes/trips/+page.svelte` — replace inline card markup with
  `TripCard`.
- `src/routes/search/+page.server.ts` — load handler.
- `src/routes/search/+page.svelte` — search results UI.
- `src/routes/search/search.test.ts` — load tests.

## Data flow

1. User types in the top search bar.
2. Each keystroke resets a 300ms timer.
3. When the timer fires, the input value is trimmed.
4. If non-empty, call `goto('/search?q=' + encodeURIComponent(value))`.
5. SvelteKit runs `+page.server.ts` load for `/search`.
6. `listViewableTrips` filters viewable trips by the query.
7. Page renders matching cards or an empty state.

## Empty state

When `q` is missing or whitespace-only:

- Heading: "Search Results"
- Body: `EmptyState` with icon `search` and message
  "Start typing to search your trips."

## Error handling

- Whitespace-only queries are ignored; the page shows the empty state.
- Debounce timer is reset on every input, so only the final value navigates.
- `/` shortcut is suppressed when `event.target` is an input, textarea, or
  content-editable element.

## Security / auth

- `requireUser` in `+page.server.ts` ensures only authenticated users can
  search.
- `listViewableTrips` already enforces ownership and sharing permissions.

## Tests

- `/search` returns all active viewable trips when a matching query is
  provided.
- `/search` returns an empty list/empty state when the query matches
  nothing.
- `/search` with no query shows the empty state.
- The `/` shortcut focuses the search input in the layout.

## Out of scope

- Advanced filters (status, tags, sort) on the search page. Keep it simple.
- Searching documents, cards, insurance, or other entities.
- Full-text search indexing; keep the existing `LIKE`-based filtering.
