<script lang="ts">
	import { getContext } from 'svelte';
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
		titleLabel = 'Title',
		titlePlaceholder = 'Enter title',
		locationLabel = 'Venue',
		locationPlaceholder = 'Enter venue',
		countryCode: countryCodeProp = tripDefaults?.countryCode ?? '',
		admin1Code: admin1CodeProp = tripDefaults?.admin1Code ?? '',
		cityName = tripDefaults?.cityName ?? '',
		cityLat = tripDefaults?.cityLat ?? null,
		cityLng = tripDefaults?.cityLng ?? null,
		venue = '',
		requireEnd = false,
		startDateLabel = 'Start date',
		startTimeLabel = 'Start time',
		endDateLabel = 'End date',
		endTimeLabel = 'End time',
		endTimezoneLabel = 'End timezone'
	}: {
		errors?: Record<string, string>;
		titleLabel?: string;
		titlePlaceholder?: string;
		locationLabel?: string;
		locationPlaceholder?: string;
		countryCode?: string;
		admin1Code?: string;
		cityName?: string;
		cityLat?: number | null;
		cityLng?: number | null;
		venue?: string;
		requireEnd?: boolean;
		startDateLabel?: string;
		startTimeLabel?: string;
		endDateLabel?: string;
		endTimeLabel?: string;
		endTimezoneLabel?: string;
	} = $props();

	let countryCode = $state(countryCodeProp);
	let admin1Code = $state(admin1CodeProp);
</script>

<TextField name="title" label={titleLabel} placeholder={titlePlaceholder} required class="sm:col-span-2" {errors} />

<DateTimeRangeFields {errors} {requireEnd} {startDateLabel} {startTimeLabel} {endDateLabel} {endTimeLabel} {endTimezoneLabel} />

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

<TextField name="venue" label={locationLabel} placeholder={locationPlaceholder} value={venue} class="sm:col-span-2" {errors} />

<TextField name="meetingPoint" label="Meeting / rally point" placeholder="e.g. Hotel lobby, gate A12" maxlength="200" class="sm:col-span-2" {errors} />

<TextField name="meetingAt" label="Rally time" type="datetime-local" {errors} />

<BookedRow {errors} />

<TextAreaField name="detail_notes" label="Notes" rows={3} placeholder="Optional notes" class="sm:col-span-2" />
