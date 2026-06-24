<script lang="ts">
	import AddSegmentFormShell from '$lib/components/segments/AddSegmentFormShell.svelte';
	import PoiForm from '$lib/components/segments/forms/PoiForm.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();
</script>

<AddSegmentFormShell trip={data.trip} label={data.label} cards={data.cards} {form}>
	<PoiForm errors={form?.errors} />
</AddSegmentFormShell>
