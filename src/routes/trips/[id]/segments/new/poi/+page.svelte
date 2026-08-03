<script lang="ts">
	import { goto } from '$app/navigation';
	import AddSegmentFormShell from '$lib/components/segments/AddSegmentFormShell.svelte';
	import PoiForm from '$lib/components/segments/forms/PoiForm.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();

	function pickPlace(e: Event) {
		const value = (e.currentTarget as HTMLSelectElement).value;
		goto(value ? `?placeId=${value}` : '?', { noScroll: true });
	}
</script>

<AddSegmentFormShell trip={data.trip} label={data.label} cards={data.cards} {form}>
	{#if data.places.length > 0}
		<div class="field sm:col-span-2">
			<label class="label" for="from-place">From places (optional)</label>
			<select
				id="from-place"
				class="input"
				value={data.placePrefill?.placeId ?? ''}
				onchange={pickPlace}
			>
				<option value="">Choose a saved place…</option>
				{#each data.places as place (place.id)}
					<option value={place.id}>{place.name}</option>
				{/each}
			</select>
			{#if data.placePrefill}
				<p class="mt-1 text-sm text-muted">Prefilled from “{data.placePrefill.title}”.</p>
			{/if}
		</div>
	{/if}
	<PoiForm errors={form?.errors} prefill={data.placePrefill} />
</AddSegmentFormShell>
