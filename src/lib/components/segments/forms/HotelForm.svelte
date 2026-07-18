<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';
	import TextField from '$lib/components/TextField.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel="Hotel name"
	titlePlaceholder="Grand Hotel"
	locationLabel="Address"
	locationPlaceholder="Enter address"
	requireEnd={true}
	startDateLabel="Check-in date"
	startTimeLabel="Check-in time"
	endDateLabel="Check-out date"
	endTimeLabel="Check-out time"
	endTimezoneLabel="Check-out timezone"
/>
<TextField name="detail_phone" label="Phone" type="tel" placeholder="Hotel phone" class="sm:col-span-2" />
