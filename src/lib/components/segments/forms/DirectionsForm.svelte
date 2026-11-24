<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import DateTimeRangeFields from '../DateTimeRangeFields.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<TextField name="title" label={m.directions_title_label()} placeholder={m.directions_title_placeholder()} required class="sm:col-span-2" {errors} />
<DateTimeRangeFields {errors} idPrefix="directions" />
<TextField name="detail_from" label={m.directions_from_label()} placeholder={m.directions_from_placeholder()} class="sm:col-span-2" />
<TextField name="location" label={m.directions_to_label()} placeholder={m.directions_to_placeholder()} class="sm:col-span-2" {errors} />
<TextAreaField name="detail_notes" label={m.directions_notes_label()} rows={3} placeholder={m.directions_notes_placeholder()} class="sm:col-span-2" />
