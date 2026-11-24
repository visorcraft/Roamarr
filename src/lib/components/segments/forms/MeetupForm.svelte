<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import StandardPlanForm from './StandardPlanForm.svelte';
	import TextField from '$lib/components/TextField.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel={m.meetup_title_label()}
	titlePlaceholder={m.meetup_title_placeholder()}
	locationLabel={m.meetup_location_label()}
	locationPlaceholder={m.meetup_location_placeholder()}
	requireEnd={true}
/>
<TextField name="detail_attendees" label={m.meetup_attendees_label()} placeholder={m.meetup_attendees_placeholder()} class="sm:col-span-2" />
