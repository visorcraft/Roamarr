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
	import { m } from '$lib/paraglide/messages';

	const tripDefaults = getContext<SegmentCityDefaults | undefined>(SEGMENT_CITY_DEFAULTS_KEY);

	let {
		errors = {},
		countryCode: countryCodeProp = tripDefaults?.countryCode ?? '',
		admin1Code: admin1CodeProp = tripDefaults?.admin1Code ?? '',
		cityName = tripDefaults?.cityName ?? '',
		cityLat = tripDefaults?.cityLat ?? null,
		cityLng = tripDefaults?.cityLng ?? null,
		venue = '',
		venueLabel = m.event_venue_label()
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
	let countryCode = $derived(countryCodeProp);
	let admin1Code = $derived(admin1CodeProp);
	let moreOpen = $state(false);
	let attendeesOpen = $state(false);
	let bookingOpen = $state(true);
</script>

<TextField name="title" label={m.event_name_label()} placeholder={m.event_name_placeholder()} required class="sm:col-span-2" {errors} />

<DateTimeRangeFields {errors} idPrefix="event" />

<div class="field">
	<label class="label" for="countryCode">{m.event_country_label()}</label>
	<select
		id="countryCode"
		name="countryCode"
		class="input {errors.countryCode ? 'input-error' : ''}"
		bind:value={countryCode}
	>
		<option value="">{m.event_country_placeholder()}</option>
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

<TextField name="venue" label={venueLabel} placeholder={m.event_venue_placeholder()} value={venue} class="sm:col-span-2" {errors} />
<TextField name="detail_phone" label={m.event_phone_label()} type="tel" placeholder={m.event_phone_placeholder()} class="sm:col-span-2" />
<TextField name="detail_website" label={m.event_website_label()} type="url" placeholder={m.event_website_placeholder()} class="sm:col-span-2" />
<TextField name="detail_email" label={m.event_email_label()} type="email" placeholder={m.event_email_placeholder()} class="sm:col-span-2" />

<BookedRow {errors} />

<TextAreaField name="detail_notes" label={m.event_notes_label()} rows={3} placeholder={m.event_notes_placeholder()} class="sm:col-span-2" />

<CollapseSection title={m.event_more_details_section()} bind:open={moreOpen}>
	<TextField name="detail_category" label={m.event_category_label()} placeholder={m.event_category_placeholder()} class="sm:col-span-2" />
	<TextField name="detail_dressCode" label={m.event_dress_code_label()} placeholder={m.event_dress_code_placeholder()} class="sm:col-span-2" />
</CollapseSection>

<CollapseSection title={m.event_attendees_section()} bind:open={attendeesOpen}>
	<TextAreaField name="detail_attendees" label={m.event_attendees_label()} rows={3} placeholder={m.event_attendees_placeholder()} class="sm:col-span-2" />
</CollapseSection>

<CollapseSection title={m.event_booking_section()} bind:open={bookingOpen}>
	<TextField name="booking_site" label={m.event_booking_site_label()} placeholder={m.event_booking_site_placeholder()} class="sm:col-span-2" />
	<TextField name="booking_reference" label={m.event_booking_reference_label()} placeholder={m.event_booking_reference_placeholder()} class="sm:col-span-2" />
	<TextField name="booking_website" label={m.event_booking_website_label()} placeholder={m.event_booking_website_placeholder()} class="sm:col-span-2" />
	<TextField name="booking_phone" label={m.event_booking_phone_label()} placeholder={m.event_booking_phone_placeholder()} class="sm:col-span-2" />
	<TextField name="booking_date" label={m.event_booking_date_label()} type="date" class="sm:col-span-2" />
	<TextField name="booking_rate" label={m.event_booking_rate_label()} placeholder={m.event_booking_rate_placeholder()} class="sm:col-span-2" />
	<TextField name="booking_totalCost" label={m.event_total_cost_label()} placeholder={m.event_total_cost_placeholder()} class="sm:col-span-2" />
	<TextAreaField name="booking_restrictions" label={m.event_restrictions_label()} rows={3} placeholder={m.event_restrictions_placeholder()} class="sm:col-span-2" />
</CollapseSection>
