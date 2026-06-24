<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel="Hotel name"
	titlePlaceholder="Grand Hotel"
	locationLabel="Address"
	locationPlaceholder="Enter address"
	requireEnd={true}
/>
<div class="field sm:col-span-2">
	<label class="label" for="detail_phone">Phone</label>
	<input id="detail_phone" name="detail_phone" type="tel" placeholder="Hotel phone" class="input" />
</div>
