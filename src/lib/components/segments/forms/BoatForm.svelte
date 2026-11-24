<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';
	import { m } from '$lib/paraglide/messages';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel={m.boat_title_label()}
	titlePlaceholder={m.boat_title_placeholder()}
	locationLabel={m.boat_location_label()}
	locationPlaceholder={m.boat_location_placeholder()}
	requireEnd={true}
/>
