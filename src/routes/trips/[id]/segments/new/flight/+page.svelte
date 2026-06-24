<script lang="ts">
	import AddSegmentFormShell from '$lib/components/segments/AddSegmentFormShell.svelte';
	import FlightForm from '$lib/components/segments/forms/FlightForm.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();
</script>

<AddSegmentFormShell trip={data.trip} label={data.label} cards={data.cards} {form}>
	<FlightForm errors={form?.errors} />
</AddSegmentFormShell>
