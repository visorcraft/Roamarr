<script lang="ts">
	import DateTimeRangeFields from '../DateTimeRangeFields.svelte';
	import BookedRow from '../BookedRow.svelte';
	import CityAutocomplete from '../CityAutocomplete.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';
	import SelectField from '$lib/components/SelectField.svelte';
	import { COUNTRIES } from '$lib/countries';

	let {
		errors = {},
		titleLabel = 'Title',
		titlePlaceholder = 'Enter title',
		locationLabel = 'Venue',
		locationPlaceholder = 'Enter venue',
		countryCode = '',
		cityName = '',
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
		cityName?: string;
		venue?: string;
		requireEnd?: boolean;
		startDateLabel?: string;
		startTimeLabel?: string;
		endDateLabel?: string;
		endTimeLabel?: string;
		endTimezoneLabel?: string;
	} = $props();
</script>

<TextField name="title" label={titleLabel} placeholder={titlePlaceholder} required class="sm:col-span-2" {errors} />

<DateTimeRangeFields {errors} {requireEnd} {startDateLabel} {startTimeLabel} {endDateLabel} {endTimeLabel} {endTimezoneLabel} />

<SelectField name="countryCode" label="Country" {errors}>
	<option value="" selected={!countryCode}>Select country</option>
	{#each COUNTRIES as c (c.code)}
		<option value={c.code} selected={c.code === countryCode}>{c.name}</option>
	{/each}
</SelectField>

<CityAutocomplete {countryCode} name="cityName" value={cityName} latName="cityLat" lngName="cityLng" {errors} />

<TextField name="venue" label={locationLabel} placeholder={locationPlaceholder} value={venue} class="sm:col-span-2" {errors} />

<TextField name="meetingPoint" label="Meeting / rally point" placeholder="e.g. Hotel lobby, gate A12" maxlength="200" class="sm:col-span-2" {errors} />

<TextField name="meetingAt" label="Rally time" type="datetime-local" {errors} />

<BookedRow {errors} />

<TextAreaField name="detail_notes" label="Notes" rows={3} placeholder="Optional notes" class="sm:col-span-2" />
