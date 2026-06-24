<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel="Meet up title"
	titlePlaceholder="Coffee with Alex"
	locationLabel="Meeting place"
	locationPlaceholder="Cafe address or landmark"
	requireEnd={true}
/>
<div class="field sm:col-span-2">
	<label class="label" for="detail_attendees">Who</label>
	<input id="detail_attendees" name="detail_attendees" placeholder="Names or group" class="input" />
</div>
