<script lang="ts">
	import { getContext } from 'svelte';
	import DateTimeRangeFields from '../DateTimeRangeFields.svelte';
	import BookedRow from '../BookedRow.svelte';
	import CityAutocomplete from '../CityAutocomplete.svelte';
	import SelectField from '$lib/components/SelectField.svelte';
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
		titleLabel = m.plan_title_label(),
		titlePlaceholder = m.plan_title_placeholder(),
		title = '',
		locationLabel = m.plan_location_label(),
		locationPlaceholder = m.plan_location_placeholder(),
		countryCode: countryCodeProp = tripDefaults?.countryCode ?? '',
		admin1Code: admin1CodeProp = tripDefaults?.admin1Code ?? '',
		cityName = tripDefaults?.cityName ?? '',
		cityLat = tripDefaults?.cityLat ?? null,
		cityLng = tripDefaults?.cityLng ?? null,
		venue = '',
		requireEnd = false,
		startDateLabel = m.datetime_start_date_label(),
		startTimeLabel = m.datetime_start_time_label(),
		endDateLabel = m.datetime_end_date_label(),
		endTimeLabel = m.datetime_end_time_label(),
		endTimezoneLabel = m.datetime_end_timezone_label()
	}: {
		errors?: Record<string, string>;
		titleLabel?: string;
		titlePlaceholder?: string;
		title?: string;
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

	let countryCode = $derived(countryCodeProp);
	let admin1Code = $derived(admin1CodeProp);
</script>

<TextField name="title" label={titleLabel} placeholder={titlePlaceholder} value={title} required class="sm:col-span-2" {errors} />

<DateTimeRangeFields {errors} {requireEnd} {startDateLabel} {startTimeLabel} {endDateLabel} {endTimeLabel} {endTimezoneLabel} />

<SelectField
	name="countryCode"
	label={m.plan_country_label()}
	value={countryCode}
	onchange={(event: Event & { currentTarget: HTMLSelectElement }) => (countryCode = event.currentTarget.value)}
	{errors}
>
	<option value="">{m.plan_country_placeholder()}</option>
	{#each COUNTRIES as c (c.code)}
		<option value={c.code}>{c.name}</option>
	{/each}
</SelectField>

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

<TextField name="meetingPoint" label={m.plan_meeting_point_label()} placeholder={m.plan_meeting_point_placeholder()} maxlength="200" class="sm:col-span-2" {errors} />

<TextField name="meetingAt" label={m.plan_rally_time_label()} type="datetime-local" {errors} />

<BookedRow {errors} />

<TextAreaField name="detail_notes" label={m.plan_notes_label()} rows={3} placeholder={m.plan_notes_placeholder()} hint={m.plan_notes_hint()} class="sm:col-span-2" />
