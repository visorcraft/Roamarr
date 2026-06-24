<script lang="ts">
	import AddSegmentFormShell from '$lib/components/segments/AddSegmentFormShell.svelte';
	import HotelForm from '$lib/components/segments/forms/HotelForm.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();
</script>

<AddSegmentFormShell trip={data.trip} label={data.label} {form}>
	<HotelForm errors={form?.errors} />
</AddSegmentFormShell>
