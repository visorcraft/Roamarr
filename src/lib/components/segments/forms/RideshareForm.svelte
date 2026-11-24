<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import { m } from '$lib/paraglide/messages';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel={m.rideshare_service_label()}
	titlePlaceholder={m.rideshare_service_placeholder()}
	locationLabel={m.rideshare_pickup_label()}
	locationPlaceholder={m.rideshare_pickup_placeholder()}
	requireEnd={true}
	startDateLabel={m.rideshare_pickup_date_label()}
	startTimeLabel={m.rideshare_pickup_time_label()}
	endDateLabel={m.rideshare_dropoff_date_label()}
	endTimeLabel={m.rideshare_dropoff_time_label()}
	endTimezoneLabel={m.rideshare_dropoff_timezone_label()}
/>
<TextField name="detail_dropoff" label={m.rideshare_dropoff_label()} placeholder={m.rideshare_dropoff_placeholder()} class="sm:col-span-2" />
