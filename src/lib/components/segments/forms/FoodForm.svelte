<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import { m } from '$lib/paraglide/messages';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel={m.food_title_label()}
	titlePlaceholder={m.food_title_placeholder()}
	locationLabel={m.food_address_label()}
	locationPlaceholder={m.food_address_placeholder()}
/>
<TextField name="detail_partySize" label={m.food_party_size_label()} placeholder={m.food_party_size_placeholder()} />
