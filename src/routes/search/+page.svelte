<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import TripCard from '$lib/components/TripCard.svelte';
	import type { TripStatus } from '$lib/tripStatus';

	type SearchTrip = {
		id: number;
		name: string;
		destinationCountryCode?: string | null;
		destinationCityName?: string | null;
		destinationCityLat?: number | null;
		destinationCityLng?: number | null;
		startDate?: string | null;
		endDate?: string | null;
		tags: string | string[];
		archived?: boolean;
		favorite?: boolean;
		defaultVisibility?: string | null;
		isShared?: boolean;
		status: TripStatus;
	};

	type SearchHit = {
		entityType: string;
		entityId: number;
		title: string;
		body: string;
		href: string;
	};

	let {
		data
	}: {
		data: { trips: SearchTrip[]; hits?: SearchHit[]; semantic?: boolean; q?: string };
	} = $props();
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Search Results</h1>
		{#if data.q}
			<p class="page-subtitle">
				{data.trips.length} trip{data.trips.length === 1 ? '' : 's'} found
				{#if data.semantic}
					<span class="badge badge-brand ml-2">Semantic</span>
				{/if}
			</p>
		{/if}
	</div>
</header>

{#if data.semantic && data.hits && data.hits.length > 0}
	<section class="mt-6">
		<h2 class="section-title">Matching items</h2>
		<ul class="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
			{#each data.hits as h (`${h.entityType}-${h.entityId}`)}
				<li>
					<a href={h.href} class="block px-4 py-3 hover:bg-muted/40">
						<div class="flex items-center gap-2">
							<span class="badge badge-slate">{h.entityType}</span>
							<span class="font-medium">{h.title}</span>
						</div>
						{#if h.body}
							<p class="mt-1 line-clamp-2 text-sm muted">{h.body}</p>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if data.trips.length}
	<div class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
		{#each data.trips as t (t.id)}
			<TripCard trip={t} />
		{/each}
	</div>
{:else if data.q}
	<EmptyState message={`No trips found for "${data.q}".`}>
		{#snippet icon()}<Icon name="search" class="h-6 w-6" />{/snippet}
	</EmptyState>
{:else}
	<EmptyState message="Start typing to search your trips.">
		{#snippet icon()}<Icon name="search" class="h-6 w-6" />{/snippet}
	</EmptyState>
{/if}
