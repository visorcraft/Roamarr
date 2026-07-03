<script lang="ts">
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import BookedCheckbox from '../BookedCheckbox.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<TextField name="title" label="Parking location" placeholder="DFW Airport parking" required class="sm:col-span-2" {errors} />

<section class="segment-form-section sm:col-span-2">
	<div class="grid gap-4 sm:grid-cols-2">
		<TextField name="startDate" label="Start date" type="date" required errorKey={['startDate', 'localStart']} {errors} />
		<TextField name="startTime" label="Start time" type="time" />
		<TextField name="endDate" label="End date" type="date" required errorKey={['endDate', 'endAt']} {errors} />
		<TextField name="endTime" label="End time" type="time" />
		<div class="field sm:col-start-2">
			<label class="label" for="startTz">Timezone</label>
			<TimezoneSelect id="startTz" name="startTz" value="UTC" class="input {errors.startTz ? 'input-error' : ''}" />
			{#if errors.startTz}<p class="field-error">{errors.startTz}</p>{/if}
		</div>
	</div>
</section>

<TextField name="location" label="Lot / garage" placeholder="Terminal garage, level 3" class="sm:col-span-2" {errors} />

<TextField name="confirmationNumber" label="Confirmation" placeholder="Enter confirmation" {errors} />
<TextField name="detail_totalCost" label="Total cost" placeholder="Enter total cost" />

<BookedCheckbox />

<TextAreaField name="detail_notes" label="Notes" rows={3} placeholder="Optional notes" class="sm:col-span-2" />
