# Global Trip Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing top-bar search input to a new `/search` page that lists matching trips with a 300ms debounce, reusing the existing trip card style.

**Architecture:** The top-bar input debounces keystrokes and navigates to `/search?q=...`. A new SvelteKit route runs the existing `listViewableTrips` query and renders a `TripCard` grid. The trip card markup is extracted into a shared component so `/trips` and `/search` stay consistent.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Tailwind v4, Vitest.

---

## File structure

- **Create:** `src/lib/components/TripCard.svelte` — shared presentational trip card.
- **Modify:** `src/routes/trips/+page.svelte` — replace inline card markup with `TripCard`.
- **Modify:** `src/routes/+layout.svelte` — add debounced `goto`, `/` shortcut, and URL sync.
- **Create:** `src/routes/search/+page.server.ts` — load handler for search results.
- **Create:** `src/routes/search/+page.svelte` — search results page UI.
- **Create:** `src/routes/search/search.test.ts` — Vitest tests for the search load handler.

---

## Task 1: Extract the `TripCard` component

**Files:**
- Create: `src/lib/components/TripCard.svelte`
- Modify: `src/routes/trips/+page.svelte`

- [ ] **Step 1: Create `TripCard.svelte`**

Create `src/lib/components/TripCard.svelte` with the existing card markup. It accepts a trip and an optional `showCheckbox` flag.

```svelte
<script lang="ts">
	import Icon from './Icon.svelte';
	import { parseTags } from '$lib/tags';
	import type { TripStatus } from '$lib/tripStatus';

	let {
		trip,
		showCheckbox = false
	}: {
		trip: {
			id: number;
			name: string;
			destination?: string | null;
			startDate?: string | null;
			endDate?: string | null;
			tags: string | string[];
			archived?: boolean;
			favorite?: boolean;
			defaultVisibility?: string | null;
			isShared?: boolean;
			status: TripStatus;
		};
		showCheckbox?: boolean;
	} = $props();

	const visBadge: Record<string, string> = {
		private: 'badge-slate',
		groups: 'badge-brand',
		public: 'badge-green'
	};

	const statusBadge: Record<TripStatus, string> = {
		planning: 'badge-slate',
		booked: 'badge-brand',
		active: 'badge-green',
		completed: 'badge-amber'
	};

	const statusLabel: Record<TripStatus, string> = {
		planning: 'Planning',
		booked: 'Booked',
		active: 'Active',
		completed: 'Completed'
	};
</script>

<div class="card group relative flex flex-col gap-3 p-5">
	{#if showCheckbox && !trip.isShared}
		<input
			type="checkbox"
			name="selected"
			value={trip.id}
			class="checkbox absolute top-3 right-3"
			onclick={(e) => e.stopPropagation()}
		/>
	{/if}
	<a href={`/trips/${trip.id}`} class="contents">
		<div class="flex items-start justify-between gap-3">
			<h2 class="section-title">
				{#if trip.favorite}<span class="text-yellow-400" title="Favorite">★</span>{/if}
				{trip.name}
			</h2>
			<div class="flex shrink-0 flex-wrap justify-end gap-1.5">
				<span class="badge {statusBadge[trip.status]} capitalize">{statusLabel[trip.status]}</span>
				{#if trip.isShared}
					<span class="badge badge-brand">Shared</span>
				{:else}
					{@const badgeClass = trip.defaultVisibility ? visBadge[trip.defaultVisibility] ?? 'badge-slate' : 'badge-slate'}
					<span class="badge {badgeClass} capitalize">{trip.defaultVisibility || 'private'}</span>
				{/if}
			</div>
		</div>
		{#if trip.destination}
			<p class="flex items-center gap-1.5 text-sm text-slate-400">
				<Icon name="location" class="h-4 w-4 text-slate-500" />
				{trip.destination}
			</p>
		{/if}
		{#if parseTags(trip.tags).length}
			<div class="flex flex-wrap gap-1.5">
				{#each parseTags(trip.tags) as tag}
					<span class="badge badge-slate text-xs">{tag}</span>
				{/each}
			</div>
		{/if}
		{#if trip.startDate || trip.endDate}
			<p class="mt-auto font-mono text-xs text-slate-500">{trip.startDate || '—'} → {trip.endDate || '—'}</p>
		{/if}
	</a>
</div>
```

- [ ] **Step 2: Replace inline cards in `/trips/+page.svelte`**

In `src/routes/trips/+page.svelte`, remove the duplicated card markup inside the `#each` block and use `TripCard`.

Replace this block (lines 134–178):

```svelte
<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
	{#each data.trips as t (t.id)}
		<div class="card group relative flex flex-col gap-3 p-5">
			{#if !t.isShared}
				<input
					type="checkbox"
					name="selected"
					value={t.id}
					class="checkbox absolute top-3 right-3"
					onclick={(e) => e.stopPropagation()}
				/>
			{/if}
			<a href={`/trips/${t.id}`} class="contents">
				...
			</a>
		</div>
	{/each}
</div>
```

with:

```svelte
<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
	{#each data.trips as t (t.id)}
		<TripCard trip={t} showCheckbox={true} />
	{/each}
</div>
```

Add the import at the top of the script block:

```ts
import TripCard from '$lib/components/TripCard.svelte';
```

Remove the now-unused `visBadge` variable from `src/routes/trips/+page.svelte`. Keep `parseTags`, `TRIP_STATUSES`, `statusBadge`, and `statusLabel` because the status filter links and tag list above the grid still use them.

- [ ] **Step 3: Run type check**

```bash
npm run check
```

Expected: no new type errors in `TripCard.svelte` or `+page.svelte`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/TripCard.svelte src/routes/trips/+page.svelte
git commit -m "refactor: extract TripCard component for reuse"
```

---

## Task 2: Create the `/search` server load handler

**Files:**
- Create: `src/routes/search/+page.server.ts`
- Create: `src/routes/search/search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/routes/search/search.test.ts`:

```ts
import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load } from './+page.server';
import { users, trips } from '$lib/server/db/schema';
import { makeGetEvent } from '../../../tests/eventHelpers';

function event(user: { id: number; email: string }, search = '') {
	return makeGetEvent(user, {}, {}, `http://localhost/search${search}`) as any;
}

test('search page requires a user', () => {
	const ev = {
		locals: { user: null },
		url: new URL('http://localhost/search'),
		request: { method: 'GET', formData: async () => new FormData() }
	} as any;
	expect(() => load(ev)).toThrow();
});

test('search with no query returns empty results', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'search-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	db.insert(trips).values({ ownerId: a.id, name: 'Paris Trip', destination: 'Paris', startDate: '2026-07-01' }).run();

	const result = load(event(a)) as any;
	expect(result.trips).toHaveLength(0);
	expect(result.q).toBeUndefined();
});

test('search filters trips by name and destination', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'search-b@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();

	db.insert(trips).values({ ownerId: a.id, name: 'Tokyo Trip', destination: 'Tokyo', startDate: '2026-08-01' }).run();
	db.insert(trips).values({ ownerId: a.id, name: 'Paris Trip', destination: 'Paris', startDate: '2026-07-01' }).run();

	const result = load(event(a, '?q=tokyo')) as any;
	expect(result.trips.map((t: any) => t.name)).toEqual(['Tokyo Trip']);
	expect(result.q).toBe('tokyo');
});

test('search excludes archived trips by default', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'search-c@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();

	db.insert(trips).values({ ownerId: a.id, name: 'Active Tokyo', destination: 'Tokyo', startDate: '2026-08-01' }).run();
	db.insert(trips).values({ ownerId: a.id, name: 'Archived Tokyo', destination: 'Tokyo', startDate: '2026-09-01', archived: true }).run();

	const result = load(event(a, '?q=tokyo')) as any;
	expect(result.trips.map((t: any) => t.name)).toEqual(['Active Tokyo']);
});

test('search trims whitespace-only queries', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'search-d@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();

	db.insert(trips).values({ ownerId: a.id, name: 'Tokyo Trip', destination: 'Tokyo', startDate: '2026-08-01' }).run();

	const result = load(event(a, '?q=%20%20')) as any;
	expect(result.trips).toHaveLength(0);
	expect(result.q).toBeUndefined();
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- src/routes/search/search.test.ts
```

Expected: tests fail because `./+page.server` does not exist.

- [ ] **Step 3: Implement `+page.server.ts`**

Create `src/routes/search/+page.server.ts`:

```ts
import { requireUser } from '$lib/server/auth';
import { listViewableTrips } from '$lib/server/sharing';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const u = requireUser(locals);
	const rawQ = url.searchParams.get('q') ?? undefined;
	const q = rawQ?.trim() || undefined;
	return { trips: listViewableTrips(u.id, { q, filter: 'active' }), q };
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- src/routes/search/search.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/search/+page.server.ts src/routes/search/search.test.ts
git commit -m "feat(search): add search results load handler and tests"
```

---

## Task 3: Create the `/search` results page UI

**Files:**
- Create: `src/routes/search/+page.svelte`

- [ ] **Step 1: Create the page**

Create `src/routes/search/+page.svelte`:

```svelte
<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import TripCard from '$lib/components/TripCard.svelte';

	let { data }: { data: { trips: any[]; q?: string } } = $props();
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Search Results</h1>
		{#if data.q}
			<p class="page-subtitle">{data.trips.length} trip{data.trips.length === 1 ? '' : 's'} found</p>
		{/if}
	</div>
</header>

{#if data.trips.length}
	<div class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
		{#each data.trips as t (t.id)}
			<TripCard trip={t} />
		{/each}
	</div>
{:else}
	<EmptyState message="Start typing to search your trips.">
		{#snippet icon()}<Icon name="search" class="h-6 w-6" />{/snippet}
	</EmptyState>
{/if}
```

- [ ] **Step 2: Run type check**

```bash
npm run check
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/search/+page.svelte
git commit -m "feat(search): add search results page UI"
```

---

## Task 4: Wire the top-bar search input

**Files:**
- Modify: `src/routes/+layout.svelte`

- [ ] **Step 1: Add required imports**

At the top of the script block, add:

```ts
import { goto } from '$app/navigation';
import { browser } from '$app/environment';
```

- [ ] **Step 2: Add search state and refs**

After the existing `$props()` line, add:

```ts
let searchInput = $state<HTMLInputElement | null>(null);
let searchValue = $state('');
let searchTimer = $state<ReturnType<typeof setTimeout> | null>(null);
```

- [ ] **Step 3: Sync input with URL and clear on non-search pages**

Add this `$effect`:

```ts
$effect(() => {
	if (!browser) return;
	const pathname = page.url.pathname;
	const q = page.url.searchParams.get('q') ?? '';
	if (searchInput === document.activeElement) return;
	if (pathname === '/search') {
		searchValue = q;
	} else if (searchValue) {
		searchValue = '';
	}
});
```

- [ ] **Step 4: Add debounced navigation and `/` shortcut**

Add these helper functions:

```ts
function goToSearch() {
	const q = searchValue.trim();
	if (q) {
		goto(`/search?q=${encodeURIComponent(q)}`);
	} else {
		goto('/search');
	}
}

function handleSearchInput() {
	if (searchTimer) clearTimeout(searchTimer);
	searchTimer = setTimeout(() => {
		goToSearch();
	}, 300);
}

function handleSearchKeydown(event: KeyboardEvent) {
	if (event.key === 'Enter') {
		event.preventDefault();
		if (searchTimer) clearTimeout(searchTimer);
		goToSearch();
	}
}

function handleGlobalKeydown(event: KeyboardEvent) {
	// Existing Escape handling for mobile menu
	if (event.key === 'Escape' && open) {
		event.preventDefault();
		open = false;
		return;
	}
	if (event.key !== '/') return;
	const target = event.target as HTMLElement | null;
	if (!target) return;
	if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
	event.preventDefault();
	searchInput?.focus();
}
```

- [ ] **Step 5: Update the window keydown handler**

Replace the existing `handleKeydown` function and its usage:

Change:
```ts
function handleKeydown(event: KeyboardEvent) {
	if (event.key === 'Escape' && open) {
		event.preventDefault();
		open = false;
	}
}
```

to use the combined `handleGlobalKeydown` from Step 4. Then update the `svelte:window` binding:

```svelte
<svelte:window onkeydown={handleGlobalKeydown} />
```

- [ ] **Step 6: Update the search input markup**

Find the existing search form input in `+layout.svelte`:

```svelte
<input
	id="app-shell-search"
	type="search"
	class="app-search-input min-w-0 flex-1 bg-transparent text-sm outline-none"
	placeholder="Search trips, plans, documents"
	autocomplete="off"
/>
```

Replace it with:

```svelte
<input
	bind:this={searchInput}
	bind:value={searchValue}
	oninput={handleSearchInput}
	onkeydown={handleSearchKeydown}
	id="app-shell-search"
	type="search"
	class="app-search-input min-w-0 flex-1 bg-transparent text-sm outline-none"
	placeholder="Search trips, plans, documents"
	autocomplete="off"
/>
```

- [ ] **Step 7: Run type check and tests**

```bash
npm run check
npm test -- src/routes/search/search.test.ts
```

Expected: `npm run check` passes and search tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/routes/+layout.svelte
git commit -m "feat(search): wire top-bar search with debounce and / shortcut"
```

---

## Task 5: Manual verification

- [ ] **Step 1: Start the dev server**

```bash
export ROAMARR_SECRET="$(openssl rand -base64 32)"
export DATABASE_PATH="./roamarr.db"
npm run dev
```

- [ ] **Step 2: Open the app and create trips**

Visit `http://127.0.0.1:3000`, log in, and create at least two trips with different names/destinations.

- [ ] **Step 3: Test top-bar search**

1. Type a query in the top search bar.
2. Wait 300ms; the page should navigate to `/search?q=<query>`.
3. Confirm matching trips appear with the same cards as `/trips`.
4. Clear the input and wait; it should navigate to `/search` with the empty state.

- [ ] **Step 4: Test the `/` shortcut**

Press `/` anywhere outside an input. The top search input should focus.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit verification notes (optional)**

If any fixes were needed, commit them with a descriptive message.

---

## Spec coverage check

| Spec requirement | Task |
| --- | --- |
| Search scope: name, destination, tags, segments | Task 2 reuses `listViewableTrips` |
| Empty-query state | Task 3 `EmptyState` |
| 300ms debounced `goto` | Task 4 |
| `/` keyboard shortcut | Task 4 |
| Reuse trip card style | Task 1 `TripCard` + Task 3 |
| Active-only filter | Task 2 `filter: 'active'` |
| Server-side auth | Task 2 `requireUser` |
| Tests | Task 2 + Task 4 |

## Placeholder scan

No TBD/TODO placeholders. Every step includes concrete file paths, code, commands, and expected outputs.
