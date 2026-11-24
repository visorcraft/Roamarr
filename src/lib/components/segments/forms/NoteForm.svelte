<script lang="ts">
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';
	import { m } from '$lib/paraglide/messages';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<TextField name="title" label={m.note_title_label()} placeholder={m.note_title_placeholder()} required class="sm:col-span-2" {errors} />

<TextAreaField name="detail_notes" label={m.note_body_label()} rows={5} placeholder={m.note_body_placeholder()} hint={m.note_markdown_hint()} required class="sm:col-span-2" />

<section class="segment-form-section sm:col-span-2">
	<div class="grid gap-4 sm:grid-cols-3">
		<TextField name="startDate" label={m.note_date_label()} type="date" required errorKey={['startDate', 'localStart']} {errors} />
		<TextField name="startTime" label={m.note_time_label()} type="time" />
		<div class="field">
			<label class="label" for="startTz">{m.datetime_timezone_label()}</label>
			<TimezoneSelect id="startTz" name="startTz" value="UTC" class="input {errors.startTz ? 'input-error' : ''}" />
			{#if errors.startTz}<p class="field-error">{errors.startTz}</p>{/if}
		</div>
	</div>
</section>
