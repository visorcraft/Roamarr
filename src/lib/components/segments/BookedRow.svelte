<script lang="ts">
	import BookedCheckbox from './BookedCheckbox.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<BookedCheckbox />
<div class="field sm:col-span-2">
	<label class="label" for="confirmationNumber">Confirmation</label>
	<input
		id="confirmationNumber"
		name="confirmationNumber"
		placeholder="Enter confirmation"
		class="input {errors.confirmationNumber ? 'input-error' : ''}"
	/>
	{#if errors.confirmationNumber}<p class="field-error">{errors.confirmationNumber}</p>{/if}
</div>
