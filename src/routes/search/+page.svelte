<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import TripCard from '$lib/components/TripCard.svelte';
	import type { TripStatus } from '$lib/tripStatus';

	type SearchTrip = {
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

	let { data }: { data: { trips: SearchTrip[]; q?: string } } = $props();
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
{:else if data.q}
	<EmptyState message={`No trips found for "${data.q}".`}>
		{#snippet icon()}<Icon name="search" class="h-6 w-6" />{/snippet}
	</EmptyState>
{:else}
	<EmptyState message="Start typing to search your trips.">
		{#snippet icon()}<Icon name="search" class="h-6 w-6" />{/snippet}
	</EmptyState>
{/if}
