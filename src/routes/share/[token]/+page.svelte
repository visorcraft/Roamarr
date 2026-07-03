<script lang="ts">
	import { SEG } from '$lib/segmentLabels';
	import { formatDateTime } from '$lib/dateFormat';
	import { formatDestination } from '$lib/tripDestination';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();
	const destinationLabel = $derived(formatDestination(data.trip.destinationCityName, data.trip.destinationCountryCode));
</script>

<div class="card w-full max-w-3xl p-7 sm:p-8">
	<p class="text-xs font-medium tracking-wide text-indigo-300/80 uppercase">Shared via {data.instanceName}</p>
	<h1 class="page-title mt-2">{data.trip.name}</h1>
	<p class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
		{#if destinationLabel}
			<span class="flex items-center gap-1.5">
				<Icon name="location" class="h-4 w-4 shrink-0 text-slate-500" />
				{destinationLabel}
			</span>
		{/if}
		{#if data.trip.startDate || data.trip.endDate}
			<span class="font-mono text-xs text-slate-500">{data.trip.startDate || '—'} → {data.trip.endDate || '—'}</span>
		{/if}
	</p>

	<h2 class="section-title mt-7 mb-3">Itinerary</h2>
	{#if data.trip.segments.length}
		<ul class="list-stack">
			{#each data.trip.segments as s, i (i)}
				<li class="list-item flex items-start gap-3">
					<span class="list-icon">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4.5 w-4.5">{@html SEG[s.type as keyof typeof SEG]?.icon ?? ''}</svg>
					</span>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="badge badge-slate">{SEG[s.type as keyof typeof SEG]?.label ?? s.type}</span>
							<span class="list-title">{s.title}</span>
						</div>
						<div class="meta-strong mt-1 text-xs">
							{formatDateTime(s.startAt, { timeZone: 'UTC' })}{#if s.endAt} → {formatDateTime(s.endAt, { timeZone: 'UTC' })}{/if}
						</div>
						{#if s.location}<div class="meta mt-0.5">{s.location}</div>{/if}
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty-text">No itinerary shared.</p>
	{/if}
</div>
