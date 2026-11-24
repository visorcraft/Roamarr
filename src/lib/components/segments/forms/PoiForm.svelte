<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';
	import { m } from '$lib/paraglide/messages';
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
	titleLabel={m.poi_title_label()}
	titlePlaceholder={m.poi_title_placeholder()}
	locationLabel={m.poi_location_label()}
	locationPlaceholder={m.poi_location_placeholder()}
	title={prefill?.title ?? ''}
	venue={prefill?.venue ?? ''}
	countryCode={prefill?.countryCode ?? undefined}
	admin1Code={prefill?.admin1Code ?? undefined}
	cityName={prefill?.cityName ?? undefined}
	cityLat={prefill?.cityLat ?? null}
	cityLng={prefill?.cityLng ?? null}
/>
