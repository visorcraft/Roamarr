<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';
	import TextField from '$lib/components/TextField.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel="Train"
	titlePlaceholder="Amtrak 123"
	locationLabel="Route"
	locationPlaceholder="Boston → New York"
/>
<TextField name="detail_seat" label="Seat / car" placeholder="Car 7, Seat 42" class="sm:col-span-2" />
