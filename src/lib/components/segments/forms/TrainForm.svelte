<script lang="ts">
	import StandardPlanForm from './StandardPlanForm.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<StandardPlanForm
	{errors}
	titleLabel="Train"
	titlePlaceholder="Amtrak 123"
	locationLabel="Route"
	locationPlaceholder="Boston → New York"
/>
<div class="field sm:col-span-2">
	<label class="label" for="detail_seat">Seat / car</label>
	<input id="detail_seat" name="detail_seat" placeholder="Car 7, Seat 42" class="input" />
</div>
