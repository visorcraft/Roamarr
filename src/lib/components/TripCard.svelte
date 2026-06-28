<script lang="ts">
	import Icon from './Icon.svelte';
	import { parseTags } from '$lib/tags';
	import { formatDestination } from '$lib/tripDestination';
	import type { TripStatus } from '$lib/tripStatus';

	let {
		trip,
		showCheckbox = false
	}: {
		trip: {
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
		showCheckbox?: boolean;
	} = $props();

	const destinationLabel = $derived(
		formatDestination(trip.destinationCityName, trip.destinationCountryCode)
	);

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
	<a
		href={`/trips/${trip.id}`}
		aria-label={trip.name}
		class="absolute inset-0 z-0 rounded-[inherit]"
	></a>
	{#if showCheckbox && !trip.isShared}
		<input
			type="checkbox"
			name="selected"
			value={trip.id}
			aria-label={`Select ${trip.name}`}
			class="checkbox absolute top-4 right-4 z-10"
			onclick={(e) => e.stopPropagation()}
		/>
	{/if}
	<div class="flex flex-col gap-3 {showCheckbox && !trip.isShared ? 'pr-7' : ''}">
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
		{#if destinationLabel}
			<p class="flex items-center gap-1.5 text-sm text-slate-400">
				<Icon name="location" class="h-4 w-4 text-slate-500" />
				{destinationLabel}
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
			<p class="mt-auto inline-flex items-center gap-1.5 font-mono text-xs text-slate-500">
				<span class="leading-none">{trip.startDate || '—'}</span>
				<Icon name="arrow-right" class="h-[0.9375rem] w-[0.9375rem] shrink-0" />
				<span class="leading-none">{trip.endDate || '—'}</span>
			</p>
		{/if}
	</div>
</div>
