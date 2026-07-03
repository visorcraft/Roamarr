<script lang="ts">
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<TextField name="title" label="Note title" placeholder="Enter note title" required class="sm:col-span-2" {errors} />

<TextAreaField name="detail_notes" label="Note" rows={5} placeholder="Enter note" required class="sm:col-span-2" />

<section class="segment-form-section sm:col-span-2">
	<div class="grid gap-4 sm:grid-cols-3">
		<TextField name="startDate" label="Date" type="date" required errorKey={['startDate', 'localStart']} {errors} />
		<TextField name="startTime" label="Time" type="time" />
		<div class="field">
			<label class="label" for="startTz">Timezone</label>
			<TimezoneSelect id="startTz" name="startTz" value="UTC" class="input {errors.startTz ? 'input-error' : ''}" />
			{#if errors.startTz}<p class="field-error">{errors.startTz}</p>{/if}
		</div>
	</div>
</section>
