<script lang="ts">
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';
	import { m } from '$lib/paraglide/messages';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<TextField name="title" label={m.todo_title_label()} placeholder={m.todo_title_placeholder()} required class="sm:col-span-2" {errors} />

<section class="segment-form-section sm:col-span-2">
	<div class="grid gap-4 sm:grid-cols-3">
		<TextField name="startDate" label={m.todo_due_date_label()} type="date" required errorKey={['startDate', 'localStart']} {errors} />
		<TextField name="startTime" label={m.todo_due_time_label()} type="time" />
		<div class="field">
			<label class="label" for="startTz">{m.datetime_timezone_label()}</label>
			<TimezoneSelect id="startTz" name="startTz" value="UTC" class="input {errors.startTz ? 'input-error' : ''}" />
			{#if errors.startTz}<p class="field-error">{errors.startTz}</p>{/if}
		</div>
	</div>
</section>

<TextAreaField name="detail_notes" label={m.todo_notes_label()} rows={3} placeholder={m.todo_notes_placeholder()} class="sm:col-span-2" />
