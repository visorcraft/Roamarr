<script lang="ts">
	import AddSegmentFormShell from '$lib/components/segments/AddSegmentFormShell.svelte';
	import BoatForm from '$lib/components/segments/forms/BoatForm.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();
</script>

<AddSegmentFormShell trip={data.trip} label={data.label} {form}>
	<BoatForm errors={form?.errors} />
</AddSegmentFormShell>
