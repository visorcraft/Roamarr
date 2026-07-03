<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';
	import TextField from '$lib/components/TextField.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel="Restaurant"
	titlePlaceholder="Dinner reservation"
	locationLabel="Address"
	locationPlaceholder="Restaurant address"
/>
<TextField name="detail_partySize" label="Party size" placeholder="2" />
