<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import { m } from '$lib/paraglide/messages';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel={m.shuttle_service_label()}
	titlePlaceholder={m.shuttle_service_placeholder()}
	locationLabel={m.shuttle_pickup_label()}
	locationPlaceholder={m.shuttle_pickup_placeholder()}
	requireEnd={true}
	startDateLabel={m.shuttle_pickup_date_label()}
	startTimeLabel={m.shuttle_pickup_time_label()}
	endDateLabel={m.shuttle_dropoff_date_label()}
	endTimeLabel={m.shuttle_dropoff_time_label()}
	endTimezoneLabel={m.shuttle_dropoff_timezone_label()}
/>
<TextField name="detail_dropoff" label={m.shuttle_dropoff_label()} placeholder={m.shuttle_dropoff_placeholder()} class="sm:col-span-2" />
