<script lang="ts">
	import DateTimeRangeFields from '../DateTimeRangeFields.svelte';
	import BookedRow from '../BookedRow.svelte';

	let {
		errors = {},
		titleLabel = 'Title',
		titlePlaceholder = 'Enter title',
		locationLabel = 'Location',
		locationPlaceholder = 'Enter location',
		requireEnd = false
	}: {
		errors?: Record<string, string>;
		titleLabel?: string;
		titlePlaceholder?: string;
		locationLabel?: string;
		locationPlaceholder?: string;
		requireEnd?: boolean;
	} = $props();
</script>

<div class="field sm:col-span-2">
	<label class="label" for="title">{titleLabel}</label>
	<input
		id="title"
		name="title"
		placeholder={titlePlaceholder}
		class="input {errors.title ? 'input-error' : ''}"
		required
	/>
	{#if errors.title}<p class="field-error">{errors.title}</p>{/if}
</div>

<DateTimeRangeFields {errors} {requireEnd} />

<div class="field sm:col-span-2">
	<label class="label" for="location">{locationLabel}</label>
	<input
		id="location"
		name="location"
		placeholder={locationPlaceholder}
		class="input {errors.location ? 'input-error' : ''}"
	/>
	{#if errors.location}<p class="field-error">{errors.location}</p>{/if}
</div>

<BookedRow {errors} />

<div class="field sm:col-span-2">
	<label class="label" for="detail_notes">Notes</label>
	<textarea id="detail_notes" name="detail_notes" rows="3" placeholder="Optional notes" class="textarea"></textarea>
</div>
