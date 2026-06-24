<script lang="ts">
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<div class="field sm:col-span-2">
	<label class="label" for="title">Note title</label>
	<input
		id="title"
		name="title"
		placeholder="Enter note title"
		class="input {errors.title ? 'input-error' : ''}"
		required
	/>
	{#if errors.title}<p class="field-error">{errors.title}</p>{/if}
</div>

<div class="field sm:col-span-2">
	<label class="label" for="detail_notes">Note</label>
	<textarea
		id="detail_notes"
		name="detail_notes"
		rows="5"
		placeholder="Enter note"
		class="textarea"
		required
	></textarea>
</div>

<section class="segment-form-section sm:col-span-2">
	<div class="grid gap-4 sm:grid-cols-3">
		<div class="field">
			<label class="label" for="startDate">
				Date<span class="text-red-400"> *</span>
			</label>
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
			<label class="label" for="startTime">Time</label>
			<input id="startTime" name="startTime" type="time" class="input" />
		</div>
		<div class="field">
			<label class="label" for="startTz">Timezone</label>
			<TimezoneSelect id="startTz" name="startTz" value="UTC" class="input {errors.startTz ? 'input-error' : ''}" />
			{#if errors.startTz}<p class="field-error">{errors.startTz}</p>{/if}
		</div>
	</div>
</section>
