<script lang="ts">
	import DateTimeRangeFields from '../DateTimeRangeFields.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<TextField name="title" label="Directions title" placeholder="Drive to hotel" required class="sm:col-span-2" {errors} />
<DateTimeRangeFields {errors} idPrefix="directions" />
<TextField name="detail_from" label="From" placeholder="Starting point" class="sm:col-span-2" />
<TextField name="location" label="To" placeholder="Destination" class="sm:col-span-2" {errors} />
<TextAreaField name="detail_notes" label="Notes" rows={3} placeholder="Turn-by-turn notes" class="sm:col-span-2" />
