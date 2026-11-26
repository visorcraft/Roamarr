<script lang="ts">
	import { ADD_SEGMENT_WIZARD_TYPES } from '$lib/segmentLabels';
	import SegmentIcon from '$lib/components/SegmentIcon.svelte';
	import CancelButton from '$lib/components/CancelButton.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<header class="page-header">
	<div>
		<a href={`/trips/${data.trip.id}`} class="back-link">
			<Icon name="back" class="h-4 w-4" />
			Back to {data.trip.name}
		</a>
		<h1 class="page-title">Add segment</h1>
		<p class="page-subtitle">Choose what you are adding to this trip.</p>
	</div>
	<CancelButton dirty={false} onConfirm={() => goto(`/trips/${data.trip.id}`)}>Cancel</CancelButton>
</header>

<div class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
	{#each ADD_SEGMENT_WIZARD_TYPES as option (option.type)}
		<a
			href={`/trips/${data.trip.id}/segments/new/${option.type}`}
			class="choice-card"
		>
			<span class="choice-icon">
				<SegmentIcon type={option.type} class="h-5 w-5" />
			</span>
			<span class="choice-title">{option.label}</span>
		</a>
	{/each}
</div>
