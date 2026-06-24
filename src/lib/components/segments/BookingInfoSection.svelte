<script lang="ts">
	import CollapseSection from './CollapseSection.svelte';

	let { open = $bindable(true) }: { open?: boolean } = $props();
</script>

<CollapseSection title="Booking info" bind:open>
	<div class="field sm:col-span-2">
		<label class="label" for="booking_site">Booking site</label>
		<input id="booking_site" name="booking_site" placeholder="Enter booking site" class="input" />
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="booking_reference">Booking reference</label>
		<input id="booking_reference" name="booking_reference" placeholder="Enter booking reference" class="input" />
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="booking_website">Booking website</label>
		<input id="booking_website" name="booking_website" placeholder="Enter booking website" class="input" />
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="booking_phone">Booking phone</label>
		<input id="booking_phone" name="booking_phone" placeholder="Enter booking phone" class="input" />
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="booking_date">Booking date</label>
		<input id="booking_date" name="booking_date" type="date" class="input" />
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="booking_rate">Booking rate</label>
		<input id="booking_rate" name="booking_rate" placeholder="Enter booking rate" class="input" />
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="booking_restrictions">Restrictions</label>
		<textarea id="booking_restrictions" name="booking_restrictions" rows="3" placeholder="Enter restrictions" class="textarea"></textarea>
	</div>
</CollapseSection>
