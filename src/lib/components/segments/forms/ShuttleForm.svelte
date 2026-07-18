<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';
	import TextField from '$lib/components/TextField.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel="Shuttle service"
	titlePlaceholder="Airport shuttle"
	locationLabel="Pickup"
	locationPlaceholder="Pickup location"
	requireEnd={true}
	startDateLabel="Pick-up date"
	startTimeLabel="Pick-up time"
	endDateLabel="Drop-off date"
	endTimeLabel="Drop-off time"
	endTimezoneLabel="Drop-off timezone"
/>
<TextField name="detail_dropoff" label="Drop-off" placeholder="Drop-off location" class="sm:col-span-2" />
