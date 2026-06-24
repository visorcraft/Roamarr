<script lang="ts">
	import AddSegmentFormShell from '$lib/components/segments/AddSegmentFormShell.svelte';
	import MeetupForm from '$lib/components/segments/forms/MeetupForm.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();
</script>

<AddSegmentFormShell trip={data.trip} label={data.label} cards={data.cards} {form}>
	<MeetupForm errors={form?.errors} />
</AddSegmentFormShell>
