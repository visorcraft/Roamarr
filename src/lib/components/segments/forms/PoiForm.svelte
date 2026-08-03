<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';
	import type { PlacePrefill } from '$lib/server/segmentNewPage';

	let {
		errors = {},
		prefill = null
	}: {
		errors?: Record<string, string>;
		/** Saved-place prefill from the "From places" picker (new poi segments). */
		prefill?: PlacePrefill | null;
	} = $props();
</script>

{#if prefill}
	<input type="hidden" name="detail_place_id" value={prefill.placeId} />
{/if}
<StandardPlanForm
	{errors}
	titleLabel="Place name"
	titlePlaceholder="Eiffel Tower"
	locationLabel="Address"
	locationPlaceholder="Enter address"
	title={prefill?.title ?? ''}
	venue={prefill?.venue ?? ''}
	countryCode={prefill?.countryCode ?? undefined}
	admin1Code={prefill?.admin1Code ?? undefined}
	cityName={prefill?.cityName ?? undefined}
	cityLat={prefill?.cityLat ?? null}
	cityLng={prefill?.cityLng ?? null}
/>
