<script lang="ts">
	import { getContext } from 'svelte';
	import CollapseSection from '../CollapseSection.svelte';
	import DateTimeRangeFields from '../DateTimeRangeFields.svelte';
	import BookedRow from '../BookedRow.svelte';
	import CityAutocomplete from '../CityAutocomplete.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';
	import { COUNTRIES } from '$lib/countries';
	import {
		SEGMENT_CITY_DEFAULTS_KEY,
		type SegmentCityDefaults
	} from '../segmentCityDefaults';
	import Admin1Select from '$lib/components/Admin1Select.svelte';

	const tripDefaults = getContext<SegmentCityDefaults | undefined>(SEGMENT_CITY_DEFAULTS_KEY);

	let {
		errors = {},
		countryCode: countryCodeProp = tripDefaults?.countryCode ?? '',
		admin1Code: admin1CodeProp = tripDefaults?.admin1Code ?? '',
		cityName = tripDefaults?.cityName ?? '',
		cityLat = tripDefaults?.cityLat ?? null,
		cityLng = tripDefaults?.cityLng ?? null,
		venue = '',
		venueLabel = 'Venue'
	}: {
		errors?: Record<string, string>;
		countryCode?: string;
		admin1Code?: string;
		cityName?: string;
		cityLat?: number | null;
		cityLng?: number | null;
		venue?: string;
		venueLabel?: string;
	} = $props();
	let countryCode = $state(countryCodeProp);
	let admin1Code = $state(admin1CodeProp);
	let moreOpen = $state(false);
	let attendeesOpen = $state(false);
	let bookingOpen = $state(true);
</script>

<TextField name="title" label="Event name" placeholder="Enter event name" required class="sm:col-span-2" {errors} />

<DateTimeRangeFields {errors} idPrefix="event" />

<div class="field">
	<label class="label" for="countryCode">Country</label>
	<select
		id="countryCode"
		name="countryCode"
		class="input {errors.countryCode ? 'input-error' : ''}"
		bind:value={countryCode}
	>
		<option value="">Select country</option>
		{#each COUNTRIES as c (c.code)}
			<option value={c.code}>{c.name}</option>
		{/each}
	</select>
	{#if errors.countryCode}<p class="field-error">{errors.countryCode}</p>{/if}
</div>

<Admin1Select {countryCode} name="admin1Code" bind:value={admin1Code} {errors} />

<CityAutocomplete
	{countryCode}
	{admin1Code}
	name="cityName"
	value={cityName}
	lat={cityLat}
	lng={cityLng}
	latName="cityLat"
	lngName="cityLng"
	{errors}
/>

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
