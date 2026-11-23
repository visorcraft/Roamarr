<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import { m } from '$lib/paraglide/messages';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel={m.hotel_name_label()}
	titlePlaceholder={m.hotel_name_placeholder()}
	locationLabel={m.hotel_address_label()}
	locationPlaceholder={m.hotel_address_placeholder()}
	requireEnd={true}
	startDateLabel={m.hotel_checkin_date_label()}
	startTimeLabel={m.hotel_checkin_time_label()}
	endDateLabel={m.hotel_checkout_date_label()}
	endTimeLabel={m.hotel_checkout_time_label()}
	endTimezoneLabel={m.hotel_checkout_timezone_label()}
/>
<TextField name="detail_phone" label={m.hotel_phone_label()} type="tel" placeholder={m.hotel_phone_placeholder()} class="sm:col-span-2" />
