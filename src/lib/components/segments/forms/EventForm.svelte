<script lang="ts">
	import CollapseSection from '../CollapseSection.svelte';
	import DateTimeRangeFields from '../DateTimeRangeFields.svelte';
	import BookedRow from '../BookedRow.svelte';
	import CityAutocomplete from '../CityAutocomplete.svelte';
	import { COUNTRIES } from '$lib/countries';

	let {
		errors = {},
		countryCode = '',
		cityName = '',
		venue = '',
		venueLabel = 'Venue'
	}: {
		errors?: Record<string, string>;
		countryCode?: string;
		cityName?: string;
		venue?: string;
		venueLabel?: string;
	} = $props();
	let moreOpen = $state(false);
	let attendeesOpen = $state(false);
	let bookingOpen = $state(true);
</script>

<div class="field sm:col-span-2">
	<label class="label" for="title">Event name</label>
	<input
		id="title"
		name="title"
		placeholder="Enter event name"
		class="input {errors.title ? 'input-error' : ''}"
		required
	/>
	{#if errors.title}<p class="field-error">{errors.title}</p>{/if}
</div>

<DateTimeRangeFields {errors} idPrefix="event" />

<div class="field">
	<label class="label" for="countryCode">Country</label>
	<select id="countryCode" name="countryCode" class="input {errors.countryCode ? 'input-error' : ''}">
		<option value="" selected={!countryCode}>Select country</option>
		{#each COUNTRIES as c}
			<option value={c.code} selected={c.code === countryCode}>{c.name}</option>
		{/each}
	</select>
	{#if errors.countryCode}<p class="field-error">{errors.countryCode}</p>{/if}
</div>

<CityAutocomplete {countryCode} name="cityName" value={cityName} latName="cityLat" lngName="cityLng" {errors} />

<div class="field sm:col-span-2">
	<label class="label" for="venue">{venueLabel}</label>
	<input
		id="venue"
		name="venue"
		placeholder="Enter venue"
		value={venue}
		class="input {errors.venue ? 'input-error' : ''}"
	/>
	{#if errors.venue}<p class="field-error">{errors.venue}</p>{/if}
</div>
<div class="field sm:col-span-2">
	<label class="label" for="detail_phone">Phone</label>
	<input id="detail_phone" name="detail_phone" type="tel" placeholder="Enter phone" class="input" />
</div>
<div class="field sm:col-span-2">
	<label class="label" for="detail_website">Website</label>
	<input id="detail_website" name="detail_website" type="url" placeholder="Enter website" class="input" />
</div>
<div class="field sm:col-span-2">
	<label class="label" for="detail_email">Email</label>
	<input id="detail_email" name="detail_email" type="email" placeholder="Enter email" class="input" />
</div>

<BookedRow {errors} />

<div class="field sm:col-span-2">
	<label class="label" for="detail_notes">Notes</label>
	<textarea id="detail_notes" name="detail_notes" rows="3" placeholder="Enter note e.g. Don't forget your charger!" class="textarea"></textarea>
</div>

<CollapseSection title="More details" bind:open={moreOpen}>
	<div class="field sm:col-span-2">
		<label class="label" for="detail_category">Category</label>
		<input id="detail_category" name="detail_category" placeholder="Concert, conference, etc." class="input" />
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="detail_dressCode">Dress code</label>
		<input id="detail_dressCode" name="detail_dressCode" placeholder="Optional dress code" class="input" />
	</div>
</CollapseSection>

<CollapseSection title="Attendees" bind:open={attendeesOpen}>
	<div class="field sm:col-span-2">
		<label class="label" for="detail_attendees">Attendees</label>
		<textarea id="detail_attendees" name="detail_attendees" rows="3" placeholder="Who is attending?" class="textarea"></textarea>
	</div>
</CollapseSection>

<CollapseSection title="Booking info" bind:open={bookingOpen}>
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
		<label class="label" for="booking_totalCost">Total cost</label>
		<input id="booking_totalCost" name="booking_totalCost" placeholder="Enter total cost" class="input" />
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="booking_restrictions">Restrictions</label>
		<textarea id="booking_restrictions" name="booking_restrictions" rows="3" placeholder="Enter restrictions" class="textarea"></textarea>
	</div>
</CollapseSection>
