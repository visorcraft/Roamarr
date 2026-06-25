<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import TripCard from '$lib/components/TripCard.svelte';
	import { parseTags } from '$lib/tags';
	import { TRIP_STATUSES, type TripStatus } from '$lib/tripStatus';

	let { data, form }: { data: { trips: { id: number; name: string; destination: string; startDate: string; endDate: string; tags: string | string[]; archived?: boolean; favorite?: boolean; defaultVisibility?: string; isShared?: boolean; status: TripStatus }[]; q?: string; tag?: string; sort: string; order: string; filter: string; status?: TripStatus }; form?: { error?: string } } = $props();
	let bulkMode = $state(false);

	const allTags = $derived(
		Array.from(
			new Set(data.trips.flatMap((t) => parseTags(t.tags).map((x) => x.toLowerCase())))
		).sort()
	);

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

	function searchHref(overrides: { status?: TripStatus | null }) {
		const params = new URLSearchParams();
		if (data.q) params.set('q', data.q);
		if (data.tag) params.set('tag', data.tag);
		if (data.sort && data.sort !== 'startDate') params.set('sort', data.sort);
		if (data.order && data.order !== 'asc') params.set('order', data.order);
		if (data.filter && data.filter !== 'active') params.set('filter', data.filter);
		if (overrides.status) params.set('status', overrides.status);
		const s = params.toString();
		return s ? `?${s}` : '?';
	}
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Trips</h1>
		<p class="page-subtitle">
			{data.trips.length} trip{data.trips.length === 1 ? '' : 's'} planned
		</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<a href="/trips/import" class="btn btn-ghost">
			<Icon name="import" class="h-4 w-4" />
			Import
		</a>
		<a href="/trips/export" class="btn btn-ghost">
			<Icon name="export" class="h-4 w-4" />
			Export
		</a>
		<a href="/trips/new" class="btn btn-primary">
			<Icon name="plus" class="h-4 w-4" />
			New trip
		</a>
	</div>
</header>

<form method="GET" action="/trips" class="mt-6 flex flex-wrap items-end gap-3">
	<label class="field flex-1 min-w-[12rem]">
		<span class="label">Search</span>
		<input type="search" name="q" value={data.q ?? ''} placeholder="Trip, destination, or segment" class="input" />
	</label>
	<label class="field min-w-[8rem]">
		<span class="label">Tag</span>
		<input type="text" name="tag" value={data.tag ?? ''} placeholder="e.g. work" class="input" />
	</label>
	<label class="field min-w-[8rem]">
		<span class="label">Sort by</span>
		<select name="sort" value={data.sort} class="input">
			<option value="startDate">Start date</option>
			<option value="name">Name</option>
			<option value="createdAt">Created</option>
		</select>
	</label>
	<label class="field min-w-[7rem]">
		<span class="label">Order</span>
		<select name="order" value={data.order} class="input">
			<option value="asc">Ascending</option>
			<option value="desc">Descending</option>
		</select>
	</label>
	<button type="submit" class="btn btn-ghost">Apply</button>
</form>

<div class="mt-4 flex gap-2">
	<a href="?filter=active" class="btn btn-sm {data.filter === 'active' ? 'btn-primary' : 'btn-ghost'}">Active</a>
	<a href="?filter=archived" class="btn btn-sm {data.filter === 'archived' ? 'btn-primary' : 'btn-ghost'}">Archived</a>
	<a href="?filter=favorites" class="btn btn-sm {data.filter === 'favorites' ? 'btn-primary' : 'btn-ghost'}">Favorites</a>
</div>

<div class="mt-3 flex flex-wrap gap-2">
	<a href={searchHref({ status: null })} class="badge {data.status ? 'badge-slate' : 'badge-brand'}">All statuses</a>
	{#each TRIP_STATUSES as status}
		<a href={searchHref({ status })} class="badge {data.status === status ? statusBadge[status] : 'badge-slate'}">{statusLabel[status]}</a>
	{/each}
</div>

{#if allTags.length}
	<div class="mt-3 flex flex-wrap gap-1.5">
		{#each allTags as tag}
			<a href="?tag={tag}" class="badge badge-slate text-xs {data.tag === tag ? 'badge-brand' : ''}">{tag}</a>
		{/each}
	</div>
{/if}

{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

{#if data.trips.length}
	<form method="POST" class="mt-6">
		<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
			<div class="flex flex-wrap gap-2">
				{#if bulkMode}
					<button type="button" class="btn btn-ghost" onclick={() => (bulkMode = false)}>Done</button>
					<button formaction="?/favorite" class="btn btn-ghost">Favorite</button>
					<button formaction="?/archive" class="btn btn-ghost">Archive</button>
					<button formaction="?/unfavorite" class="btn btn-ghost">Unfavorite</button>
					<button formaction="?/unarchive" class="btn btn-ghost">Unarchive</button>
					<button formaction="?/delete" class="btn btn-danger">Delete</button>
				{:else}
					<button type="button" class="btn btn-ghost" onclick={() => (bulkMode = true)}>
						<Icon name="check" class="h-4 w-4" />
						Bulk actions
					</button>
				{/if}
			</div>
		</div>
		<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
			{#each data.trips as t (t.id)}
				<TripCard trip={t} showCheckbox={bulkMode} />
			{/each}
		</div>
	</form>
{:else}
	<EmptyState
		message="No trips yet — plan your first one."
		actionHref="/trips/new"
		actionLabel="Create a trip"
	>
		{#snippet icon()}<Icon name="trips" class="h-6 w-6" />{/snippet}
	</EmptyState>
{/if}
