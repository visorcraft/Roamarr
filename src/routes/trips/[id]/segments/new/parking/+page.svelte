<script lang="ts">
	import AddSegmentFormShell from '$lib/components/segments/AddSegmentFormShell.svelte';
	import ParkingForm from '$lib/components/segments/forms/ParkingForm.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();
</script>

<AddSegmentFormShell trip={data.trip} label={data.label} {form}>
	<ParkingForm errors={form?.errors} />
</AddSegmentFormShell>
