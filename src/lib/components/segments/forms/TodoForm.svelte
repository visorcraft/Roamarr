<script lang="ts">
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<TextField name="title" label="Todo item" placeholder="What needs to be done?" required class="sm:col-span-2" {errors} />

<section class="segment-form-section sm:col-span-2">
	<div class="grid gap-4 sm:grid-cols-3">
		<TextField name="startDate" label="Due date" type="date" required errorKey={['startDate', 'localStart']} {errors} />
		<TextField name="startTime" label="Due time" type="time" />
		<div class="field">
			<label class="label" for="startTz">Timezone</label>
			<TimezoneSelect id="startTz" name="startTz" value="UTC" class="input {errors.startTz ? 'input-error' : ''}" />
			{#if errors.startTz}<p class="field-error">{errors.startTz}</p>{/if}
		</div>
	</div>
</section>

<TextAreaField name="detail_notes" label="Notes" rows={3} placeholder="Additional details (optional)" class="sm:col-span-2" />
