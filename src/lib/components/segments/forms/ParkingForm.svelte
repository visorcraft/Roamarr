<script lang="ts">
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import BookedCheckbox from '../BookedCheckbox.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<div class="field sm:col-span-2">
	<label class="label" for="title">Parking location</label>
	<input
		id="title"
		name="title"
		placeholder="DFW Airport parking"
		class="input {errors.title ? 'input-error' : ''}"
		required
	/>
	{#if errors.title}<p class="field-error">{errors.title}</p>{/if}
</div>

<section class="segment-form-section sm:col-span-2">
	<div class="grid gap-4 sm:grid-cols-2">
		<div class="field">
			<label class="label" for="startDate">Start date</label>
			<input
				id="startDate"
				name="startDate"
				type="date"
				class="input {errors.startDate || errors.localStart ? 'input-error' : ''}"
				required
			/>
			{#if errors.startDate}<p class="field-error">{errors.startDate}</p>{/if}
			{#if errors.localStart}<p class="field-error">{errors.localStart}</p>{/if}
		</div>
		<div class="field">
			<label class="label" for="startTime">Start time</label>
			<input id="startTime" name="startTime" type="time" class="input" />
		</div>
		<div class="field">
			<label class="label" for="endDate">End date</label>
			<input
				id="endDate"
				name="endDate"
				type="date"
				class="input {errors.endDate || errors.endAt ? 'input-error' : ''}"
				required
			/>
			{#if errors.endDate}<p class="field-error">{errors.endDate}</p>{/if}
			{#if errors.endAt}<p class="field-error">{errors.endAt}</p>{/if}
		</div>
		<div class="field">
			<label class="label" for="endTime">End time</label>
			<input id="endTime" name="endTime" type="time" class="input" />
		</div>
		<div class="field sm:col-start-2">
			<label class="label" for="startTz">Timezone</label>
			<TimezoneSelect id="startTz" name="startTz" value="UTC" class="input {errors.startTz ? 'input-error' : ''}" />
			{#if errors.startTz}<p class="field-error">{errors.startTz}</p>{/if}
		</div>
	</div>
</section>

<div class="field sm:col-span-2">
	<label class="label" for="location">Lot / garage</label>
	<input
		id="location"
		name="location"
		placeholder="Terminal garage, level 3"
		class="input {errors.location ? 'input-error' : ''}"
	/>
	{#if errors.location}<p class="field-error">{errors.location}</p>{/if}
</div>

<div class="field">
	<label class="label" for="confirmationNumber">Confirmation</label>
	<input
		id="confirmationNumber"
		name="confirmationNumber"
		placeholder="Enter confirmation"
		class="input {errors.confirmationNumber ? 'input-error' : ''}"
	/>
	{#if errors.confirmationNumber}<p class="field-error">{errors.confirmationNumber}</p>{/if}
</div>
<div class="field">
	<label class="label" for="detail_totalCost">Total cost</label>
	<input id="detail_totalCost" name="detail_totalCost" placeholder="Enter total cost" class="input" />
</div>

<BookedCheckbox />

<div class="field sm:col-span-2">
	<label class="label" for="detail_notes">Notes</label>
	<textarea id="detail_notes" name="detail_notes" rows="3" placeholder="Optional notes" class="textarea"></textarea>
</div>
