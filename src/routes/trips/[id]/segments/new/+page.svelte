<script lang="ts">
	import { ADD_SEGMENT_WIZARD_TYPES, SEG } from '$lib/segmentLabels';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<header class="page-header">
	<div>
		<a href={`/trips/${data.trip.id}`} class="mb-2 inline-flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-white">
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
			class="card group flex items-center gap-3 p-3.5 text-left transition hover:-translate-y-0.5 hover:ring-white/20"
		>
			<span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-400/20">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">{@html SEG[option.type].icon}</svg>
			</span>
			<span class="min-w-0 font-display text-sm font-bold leading-snug text-white">{option.label}</span>
		</a>
	{/each}
</div>
