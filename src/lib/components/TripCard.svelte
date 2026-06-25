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
			<p class="mt-auto inline-flex items-center gap-1.5 font-mono text-xs text-slate-500">
				<span class="leading-none">{trip.startDate || '—'}</span>
				<Icon name="arrow-right" class="h-[0.9375rem] w-[0.9375rem] shrink-0" />
				<span class="leading-none">{trip.endDate || '—'}</span>
			</p>
		{/if}
	</a>
</div>
