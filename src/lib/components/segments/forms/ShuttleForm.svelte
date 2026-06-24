<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel="Shuttle service"
	titlePlaceholder="Airport shuttle"
	locationLabel="Pickup"
	locationPlaceholder="Pickup location"
	requireEnd={true}
/>
<div class="field sm:col-span-2">
	<label class="label" for="detail_dropoff">Drop-off</label>
	<input id="detail_dropoff" name="detail_dropoff" placeholder="Drop-off location" class="input" />
</div>
