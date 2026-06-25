<script lang="ts">
	import { ADD_SEGMENT_WIZARD_TYPES, SEG } from '$lib/segmentLabels';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<header class="page-header">
	<div>
		<a href={`/trips/${data.trip.id}`} class="back-link">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
			Back to {data.trip.name}
		</a>
		<h1 class="page-title">Add segment</h1>
		<p class="page-subtitle">Choose what you are adding to this trip.</p>
	</div>
	<a href={`/trips/${data.trip.id}`} class="btn btn-ghost">Cancel</a>
</header>

<div class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
	{#each ADD_SEGMENT_WIZARD_TYPES as option (option.type)}
		<a
			href={`/trips/${data.trip.id}/segments/new/${option.type}`}
			class="choice-card"
		>
			<span class="choice-icon">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">{@html SEG[option.type].icon}</svg>
			</span>
			<span class="choice-title">{option.label}</span>
		</a>
	{/each}
</div>
