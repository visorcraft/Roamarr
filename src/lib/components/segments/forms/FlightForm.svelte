<script lang="ts">
	import { getContext } from 'svelte';
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import CollapseSection from '../CollapseSection.svelte';
	import BookedCheckbox from '../BookedCheckbox.svelte';
	import BookingInfoSection from '../BookingInfoSection.svelte';
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
		cityLat = tripDefaults?.cityLat ?? null,
		cityLng = tripDefaults?.cityLng ?? null
	}: {
		errors?: Record<string, string>;
		cityLat?: number | null;
		cityLng?: number | null;
	} = $props();

	let flightCount = $state(1);
	let manualOpen = $state(false);
	let aircraftOpen = $state(false);
	let passengersOpen = $state(false);
	let bookingOpen = $state(true);
	// Seed from trip destination (context); user can change via the form controls.
	let countryCode = $state(tripDefaults?.countryCode ?? '');
	let admin1Code = $state(tripDefaults?.admin1Code ?? '');
	let cityName = $state(tripDefaults?.cityName ?? '');

	function expandAll() {
		manualOpen = true;
		aircraftOpen = true;
		passengersOpen = true;
		bookingOpen = true;
	}

	function addFlight() {
		if (flightCount < 4) flightCount += 1;
	}

	function flightName(index: number, field: string) {
		if (index === 0) {
			if (field === 'date') return 'startDate';
			if (field === 'number') return 'title';
			if (field === 'airline') return 'detail_airline';
			if (field === 'seats') return 'detail_seats';
			return field;
		}
		return `detail_flight${index + 1}_${field}`;
	}
</script>

<TextField name="confirmationNumber" label={m.flight_confirmation_label()} placeholder={m.flight_confirmation_placeholder()} {errors} />
<TextField name="detail_totalCost" label={m.flight_total_cost_label()} placeholder={m.flight_total_cost_placeholder()} />

<BookedCheckbox />

{#each Array.from({ length: flightCount }, (_, i) => i) as index (index)}
	<section class="segment-form-section sm:col-span-2">
		<h3 class="section-title mb-4">{m.flight_section_title({ number: index + 1 })}</h3>

		<div class="grid gap-4 sm:grid-cols-2">
			<TextField
				name={flightName(index, 'date')}
				label={m.flight_departure_date_label()}
				type="date"
				required={index === 0}
				errorKey={index === 0 ? ['startDate', 'localStart'] : []}
				{errors}
			/>
			<TextField name={flightName(index, 'airline')} label={m.flight_airline_label()} placeholder={m.flight_airline_placeholder()} required={index === 0} />
			<TextField
				name={flightName(index, 'number')}
				label={m.flight_number_label()}
				placeholder={m.flight_number_placeholder()}
				required={index === 0}
				errorKey={index === 0 ? ['title'] : []}
				{errors}
			/>
			<TextField name={flightName(index, 'seats')} label={m.flight_seats_label()} placeholder={m.flight_seats_placeholder()} />
		</div>

		{#if index === 0}
			<SelectField
				name="countryCode"
				label={m.flight_country_label()}
				value={countryCode}
				onchange={(event: Event & { currentTarget: HTMLSelectElement }) => (countryCode = event.currentTarget.value)}
				{errors}
			>
				<option value="">{m.flight_country_placeholder()}</option>
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

			<TextField name="venue" label={m.flight_venue_label()} placeholder={m.flight_venue_placeholder()} class="sm:col-span-2" {errors} />

			<CollapseSection title={m.flight_manual_section()} bind:open={manualOpen}>
				<TextField name="detail_departAirport" label={m.flight_departure_airport_label()} placeholder={m.flight_departure_airport_placeholder()} />
				<TextField name="detail_arriveAirport" label={m.flight_arrival_airport_label()} placeholder={m.flight_arrival_airport_placeholder()} />
				<TextField name="startTime" label={m.flight_departure_time_label()} type="time" />
				<TextField name="endDate" label={m.flight_arrival_date_label()} type="date" errorKey={['endAt']} {errors} />
				<TextField name="endTime" label={m.flight_arrival_time_label()} type="time" />
				<div class="field sm:col-span-2">
					<label class="label" for="startTz">{m.flight_timezone_label()}</label>
					<TimezoneSelect id="startTz" name="startTz" value="UTC" class="input {errors.startTz ? 'input-error' : ''}" />
					{#if errors.startTz}<p class="field-error">{errors.startTz}</p>{/if}
				</div>
				<div class="field sm:col-span-2">
					<label class="label" for="endTz">{m.flight_arrival_timezone_label()}</label>
					<TimezoneSelect id="endTz" name="endTz" value="UTC" class="input {errors.endTz ? 'input-error' : ''}" />
					{#if errors.endTz}<p class="field-error">{errors.endTz}</p>{/if}
				</div>
				<TextField name="location" label={m.flight_route_label()} placeholder={m.flight_route_placeholder()} class="sm:col-span-2" {errors} />
			</CollapseSection>

			<CollapseSection title={m.flight_aircraft_section()} bind:open={aircraftOpen}>
				<TextField name="detail_aircraft" label={m.flight_aircraft_label()} placeholder={m.flight_aircraft_placeholder()} class="sm:col-span-2" />
				<TextField name="detail_cabin" label={m.flight_cabin_label()} placeholder={m.flight_cabin_placeholder()} class="sm:col-span-2" />
				<TextField name="detail_frequentFlyer" label={m.flight_frequent_flyer_label()} placeholder={m.flight_frequent_flyer_placeholder()} class="sm:col-span-2" />
			</CollapseSection>
		{/if}
	</section>
{/each}

<TextField name="meetingPoint" label={m.flight_meeting_point_label()} placeholder={m.flight_meeting_point_placeholder()} maxlength="200" class="sm:col-span-2" {errors} />

<TextField name="meetingAt" label={m.flight_rally_time_label()} type="datetime-local" {errors} />

<div class="sm:col-span-2">
	<button type="button" class="btn btn-ghost" onclick={addFlight}>
		<Icon name="plus" class="h-4 w-4" />
		{m.flight_add_button()}
	</button>
</div>

<TextAreaField name="detail_notes" label={m.flight_notes_label()} rows={3} placeholder={m.flight_notes_placeholder()} class="sm:col-span-2" />

<div class="segment-form-section sm:col-span-2">
	<div class="panel-header">
		<h3 class="section-title">{m.flight_more_details_section()}</h3>
		<button type="button" class="link text-sm no-underline" onclick={expandAll}>{m.flight_expand_all()}</button>
	</div>

	<CollapseSection title={m.flight_passengers_section()} bind:open={passengersOpen}>
		<TextAreaField name="detail_passengers" label={m.flight_passengers_label()} rows={3} placeholder={m.flight_passengers_placeholder()} class="sm:col-span-2" />
	</CollapseSection>

	<BookingInfoSection bind:open={bookingOpen} />
</div>
