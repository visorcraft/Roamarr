<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';
	import TextField from '$lib/components/TextField.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel="Service"
	titlePlaceholder="Uber / Lyft"
	locationLabel="Pickup"
	locationPlaceholder="Pickup address"
	requireEnd={true}
	startDateLabel="Pick-up date"
	startTimeLabel="Pick-up time"
	endDateLabel="Drop-off date"
	endTimeLabel="Drop-off time"
	endTimezoneLabel="Drop-off timezone"
/>
<TextField name="detail_dropoff" label="Drop-off" placeholder="Drop-off address" class="sm:col-span-2" />
