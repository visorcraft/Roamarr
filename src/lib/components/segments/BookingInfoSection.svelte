<script lang="ts">
	import CollapseSection from './CollapseSection.svelte';
	import { m } from '$lib/paraglide/messages';

	let { open = $bindable(true) }: { open?: boolean } = $props();
</script>

<CollapseSection title={m.booking_section()} bind:open>
	<div class="field sm:col-span-2">
		<label class="label" for="booking_site">{m.booking_site_label()}</label>
		<input id="booking_site" name="booking_site" placeholder={m.booking_site_placeholder()} class="input" />
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="booking_reference">{m.booking_reference_label()}</label>
		<input id="booking_reference" name="booking_reference" placeholder={m.booking_reference_placeholder()} class="input" />
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="booking_website">{m.booking_website_label()}</label>
		<input id="booking_website" name="booking_website" placeholder={m.booking_website_placeholder()} class="input" />
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="booking_phone">{m.booking_phone_label()}</label>
		<input id="booking_phone" name="booking_phone" placeholder={m.booking_phone_placeholder()} class="input" />
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="booking_date">{m.booking_date_label()}</label>
		<input id="booking_date" name="booking_date" type="date" class="input" />
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="booking_rate">{m.booking_rate_label()}</label>
		<input id="booking_rate" name="booking_rate" placeholder={m.booking_rate_placeholder()} class="input" />
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="booking_restrictions">{m.booking_restrictions_label()}</label>
		<textarea id="booking_restrictions" name="booking_restrictions" rows="3" placeholder={m.booking_restrictions_placeholder()} class="textarea"></textarea>
	</div>
</CollapseSection>
