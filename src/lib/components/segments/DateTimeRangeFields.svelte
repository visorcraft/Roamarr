<script lang="ts">
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';

	let {
		errors = {},
		idPrefix = 'segment',
		requireEnd = false
	}: { errors?: Record<string, string>; idPrefix?: string; requireEnd?: boolean } = $props();
</script>

<div class="field">
	<label class="label" for="{idPrefix}-startDate">Start date</label>
	<input
		id="{idPrefix}-startDate"
		name="startDate"
		type="date"
		class="input {errors.startDate || errors.localStart ? 'input-error' : ''}"
		required
	/>
	{#if errors.startDate}<p class="field-error">{errors.startDate}</p>{/if}
</div>
<div class="field">
	<label class="label" for="{idPrefix}-startTime">Start time</label>
	<input id="{idPrefix}-startTime" name="startTime" type="time" class="input {errors.localStart ? 'input-error' : ''}" />
	{#if errors.localStart}<p class="field-error">{errors.localStart}</p>{/if}
</div>
<div class="field">
	<label class="label" for="{idPrefix}-startTz">Timezone</label>
	<TimezoneSelect
		id="{idPrefix}-startTz"
		name="startTz"
		value="UTC"
		class="input {errors.startTz ? 'input-error' : ''}"
	/>
	{#if errors.startTz}<p class="field-error">{errors.startTz}</p>{/if}
</div>
<div class="field">
	<label class="label" for="{idPrefix}-endDate">End date</label>
	<input
		id="{idPrefix}-endDate"
		name="endDate"
		type="date"
		class="input {errors.endDate || errors.endAt ? 'input-error' : ''}"
		required={requireEnd}
	/>
	{#if errors.endDate}<p class="field-error">{errors.endDate}</p>{/if}
</div>
<div class="field">
	<label class="label" for="{idPrefix}-endTime">End time</label>
	<input id="{idPrefix}-endTime" name="endTime" type="time" class="input {errors.endAt ? 'input-error' : ''}" />
	{#if errors.endAt}<p class="field-error">{errors.endAt}</p>{/if}
</div>
<div class="field">
	<label class="label" for="{idPrefix}-endTz">End timezone</label>
	<TimezoneSelect
		id="{idPrefix}-endTz"
		name="endTz"
		value="UTC"
		class="input {errors.endTz ? 'input-error' : ''}"
	/>
	{#if errors.endTz}<p class="field-error">{errors.endTz}</p>{/if}
</div>
