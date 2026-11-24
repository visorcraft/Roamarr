<script lang="ts">
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import BookedCheckbox from '../BookedCheckbox.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';
	import { m } from '$lib/paraglide/messages';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<TextField name="title" label={m.parking_location_label()} placeholder={m.parking_location_placeholder()} required class="sm:col-span-2" {errors} />

<section class="segment-form-section sm:col-span-2">
	<div class="grid gap-4 sm:grid-cols-2">
		<TextField name="startDate" label={m.datetime_start_date_label()} type="date" required errorKey={['startDate', 'localStart']} {errors} />
		<TextField name="startTime" label={m.datetime_start_time_label()} type="time" />
		<TextField name="endDate" label={m.datetime_end_date_label()} type="date" required errorKey={['endDate', 'endAt']} {errors} />
		<TextField name="endTime" label={m.datetime_end_time_label()} type="time" />
		<div class="field sm:col-start-2">
			<label class="label" for="startTz">{m.datetime_timezone_label()}</label>
			<TimezoneSelect id="startTz" name="startTz" value="UTC" class="input {errors.startTz ? 'input-error' : ''}" />
			{#if errors.startTz}<p class="field-error">{errors.startTz}</p>{/if}
		</div>
	</div>
</section>

<TextField name="location" label={m.parking_lot_label()} placeholder={m.parking_lot_placeholder()} class="sm:col-span-2" {errors} />

<TextField name="confirmationNumber" label={m.parking_confirmation_label()} placeholder={m.parking_confirmation_placeholder()} {errors} />
<TextField name="detail_totalCost" label={m.parking_total_cost_label()} placeholder={m.parking_total_cost_placeholder()} />

<BookedCheckbox />

<TextAreaField name="detail_notes" label={m.parking_notes_label()} rows={3} placeholder={m.parking_notes_placeholder()} class="sm:col-span-2" />
