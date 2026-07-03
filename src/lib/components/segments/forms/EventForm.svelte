<script lang="ts">
	import CollapseSection from '../CollapseSection.svelte';
	import DateTimeRangeFields from '../DateTimeRangeFields.svelte';
	import BookedRow from '../BookedRow.svelte';
	import CityAutocomplete from '../CityAutocomplete.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';
	import SelectField from '$lib/components/SelectField.svelte';
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

<TextField name="title" label="Event name" placeholder="Enter event name" required class="sm:col-span-2" {errors} />

<DateTimeRangeFields {errors} idPrefix="event" />

<SelectField name="countryCode" label="Country" {errors}>
	<option value="" selected={!countryCode}>Select country</option>
	{#each COUNTRIES as c (c.code)}
		<option value={c.code} selected={c.code === countryCode}>{c.name}</option>
	{/each}
</SelectField>

<CityAutocomplete {countryCode} name="cityName" value={cityName} latName="cityLat" lngName="cityLng" {errors} />

<TextField name="venue" label={venueLabel} placeholder="Enter venue" value={venue} class="sm:col-span-2" {errors} />
<TextField name="detail_phone" label="Phone" type="tel" placeholder="Enter phone" class="sm:col-span-2" />
<TextField name="detail_website" label="Website" type="url" placeholder="Enter website" class="sm:col-span-2" />
<TextField name="detail_email" label="Email" type="email" placeholder="Enter email" class="sm:col-span-2" />

<BookedRow {errors} />

<TextAreaField name="detail_notes" label="Notes" rows={3} placeholder="Enter note e.g. Don't forget your charger!" class="sm:col-span-2" />

<CollapseSection title="More details" bind:open={moreOpen}>
	<TextField name="detail_category" label="Category" placeholder="Concert, conference, etc." class="sm:col-span-2" />
	<TextField name="detail_dressCode" label="Dress code" placeholder="Optional dress code" class="sm:col-span-2" />
</CollapseSection>

<CollapseSection title="Attendees" bind:open={attendeesOpen}>
	<TextAreaField name="detail_attendees" label="Attendees" rows={3} placeholder="Who is attending?" class="sm:col-span-2" />
</CollapseSection>

<CollapseSection title="Booking info" bind:open={bookingOpen}>
	<TextField name="booking_site" label="Booking site" placeholder="Enter booking site" class="sm:col-span-2" />
	<TextField name="booking_reference" label="Booking reference" placeholder="Enter booking reference" class="sm:col-span-2" />
	<TextField name="booking_website" label="Booking website" placeholder="Enter booking website" class="sm:col-span-2" />
	<TextField name="booking_phone" label="Booking phone" placeholder="Enter booking phone" class="sm:col-span-2" />
	<TextField name="booking_date" label="Booking date" type="date" class="sm:col-span-2" />
	<TextField name="booking_rate" label="Booking rate" placeholder="Enter booking rate" class="sm:col-span-2" />
	<TextField name="booking_totalCost" label="Total cost" placeholder="Enter total cost" class="sm:col-span-2" />
	<TextAreaField name="booking_restrictions" label="Restrictions" rows={3} placeholder="Enter restrictions" class="sm:col-span-2" />
</CollapseSection>
