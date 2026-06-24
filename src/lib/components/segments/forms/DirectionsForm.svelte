<script lang="ts">
	import DateTimeRangeFields from '../DateTimeRangeFields.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<div class="field sm:col-span-2">
	<label class="label" for="title">Directions title</label>
	<input id="title" name="title" placeholder="Drive to hotel" class="input {errors.title ? 'input-error' : ''}" required />
	{#if errors.title}<p class="field-error">{errors.title}</p>{/if}
</div>
<DateTimeRangeFields {errors} idPrefix="directions" />
<div class="field sm:col-span-2">
	<label class="label" for="detail_from">From</label>
	<input id="detail_from" name="detail_from" placeholder="Starting point" class="input" />
</div>
<div class="field sm:col-span-2">
	<label class="label" for="location">To</label>
	<input id="location" name="location" placeholder="Destination" class="input {errors.location ? 'input-error' : ''}" />
	{#if errors.location}<p class="field-error">{errors.location}</p>{/if}
</div>
<div class="field sm:col-span-2">
	<label class="label" for="detail_notes">Notes</label>
	<textarea id="detail_notes" name="detail_notes" rows="3" placeholder="Turn-by-turn notes" class="textarea"></textarea>
</div>
