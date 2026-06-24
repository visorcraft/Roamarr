<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel="Restaurant"
	titlePlaceholder="Dinner reservation"
	locationLabel="Address"
	locationPlaceholder="Restaurant address"
/>
<div class="field">
	<label class="label" for="detail_partySize">Party size</label>
	<input id="detail_partySize" name="detail_partySize" placeholder="2" class="input" />
</div>
