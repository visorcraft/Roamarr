<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import { m } from '$lib/paraglide/messages';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel={m.train_title_label()}
	titlePlaceholder={m.train_title_placeholder()}
	locationLabel={m.train_route_label()}
	locationPlaceholder={m.train_route_placeholder()}
/>
<TextField name="detail_seat" label={m.train_seat_label()} placeholder={m.train_seat_placeholder()} class="sm:col-span-2" />
