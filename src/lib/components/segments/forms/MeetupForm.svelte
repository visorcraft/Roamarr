<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';
	import TextField from '$lib/components/TextField.svelte';

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
<TextField name="detail_attendees" label="Who" placeholder="Names or group" class="sm:col-span-2" />
