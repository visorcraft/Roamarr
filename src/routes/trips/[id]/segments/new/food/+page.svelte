<script lang="ts">
	import AddSegmentFormShell from '$lib/components/segments/AddSegmentFormShell.svelte';
	import FoodForm from '$lib/components/segments/forms/FoodForm.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();
</script>

<AddSegmentFormShell trip={data.trip} label={data.label} cards={data.cards} {form}>
	<FoodForm errors={form?.errors} />
</AddSegmentFormShell>
