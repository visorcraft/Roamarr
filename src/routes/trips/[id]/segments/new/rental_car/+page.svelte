<script lang="ts">
	import AddSegmentFormShell from '$lib/components/segments/AddSegmentFormShell.svelte';
	import RentalCarForm from '$lib/components/segments/forms/RentalCarForm.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();
</script>

<AddSegmentFormShell trip={data.trip} label={data.label} {form}>
	<RentalCarForm errors={form?.errors} />
</AddSegmentFormShell>
