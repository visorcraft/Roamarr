<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel="Cruise / ferry name"
	titlePlaceholder="Harbor ferry"
	locationLabel="Port / pier"
	locationPlaceholder="Pier 33"
	requireEnd={true}
/>
