<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel="Place name"
	titlePlaceholder="Eiffel Tower"
	locationLabel="Address"
	locationPlaceholder="Enter address"
/>
