<script lang="ts">
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import CollapseSection from '../CollapseSection.svelte';
	import BookedCheckbox from '../BookedCheckbox.svelte';
	import BookingInfoSection from '../BookingInfoSection.svelte';
	import CityAutocomplete from '../CityAutocomplete.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';
	import { COUNTRIES } from '$lib/countries';

	let { errors = {} }: { errors?: Record<string, string> } = $props();

	let flightCount = $state(1);
	let manualOpen = $state(false);
	let aircraftOpen = $state(false);
	let passengersOpen = $state(false);
	let bookingOpen = $state(true);
	let countryCode = $state('');
	let cityName = $state('');

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

<TextField name="confirmationNumber" label="Confirmation" placeholder="Enter confirmation" {errors} />
<TextField name="detail_totalCost" label="Total cost" placeholder="Enter total cost" />

<BookedCheckbox />

{#each Array.from({ length: flightCount }, (_, i) => i) as index (index)}
	<section class="segment-form-section sm:col-span-2">
		<h3 class="section-title mb-4">Flight {index + 1}</h3>

		<div class="grid gap-4 sm:grid-cols-2">
			<TextField
				name={flightName(index, 'date')}
				label="Departure date"
				type="date"
				required={index === 0}
				errorKey={index === 0 ? ['startDate', 'localStart'] : []}
				{errors}
			/>
			<TextField name={flightName(index, 'airline')} label="Airline" placeholder="Enter airline" required={index === 0} />
			<TextField
				name={flightName(index, 'number')}
				label="Flight number"
				placeholder="Enter flight number"
				required={index === 0}
				errorKey={index === 0 ? ['title'] : []}
				{errors}
			/>
			<TextField name={flightName(index, 'seats')} label="Seats" placeholder="Enter seats" />
		</div>

		{#if index === 0}
			<div class="field">
				<label class="label" for="countryCode">Country</label>
				<select id="countryCode" name="countryCode" bind:value={countryCode} class="input {errors.countryCode ? 'input-error' : ''}">
					<option value="" selected={!countryCode}>Select country</option>
					{#each COUNTRIES as c (c.code)}
						<option value={c.code} selected={c.code === countryCode}>{c.name}</option>
					{/each}
				</select>
				{#if errors.countryCode}<p class="field-error">{errors.countryCode}</p>{/if}
			</div>

			<CityAutocomplete {countryCode} name="cityName" value={cityName} latName="cityLat" lngName="cityLng" {errors} />

			<TextField name="venue" label="Venue" placeholder="Airport or terminal" class="sm:col-span-2" {errors} />

			<CollapseSection title="Manually edit flight" bind:open={manualOpen}>
				<TextField name="detail_departAirport" label="Departure airport" placeholder="JFK" />
				<TextField name="detail_arriveAirport" label="Arrival airport" placeholder="LHR" />
				<TextField name="startTime" label="Departure time" type="time" />
				<TextField name="endDate" label="Arrival date" type="date" errorKey={['endAt']} {errors} />
				<TextField name="endTime" label="Arrival time" type="time" />
				<div class="field sm:col-span-2">
					<label class="label" for="startTz">Timezone</label>
					<TimezoneSelect id="startTz" name="startTz" value="UTC" class="input {errors.startTz ? 'input-error' : ''}" />
					{#if errors.startTz}<p class="field-error">{errors.startTz}</p>{/if}
				</div>
				<div class="field sm:col-span-2">
					<label class="label" for="endTz">Arrival timezone</label>
					<TimezoneSelect id="endTz" name="endTz" value="UTC" class="input {errors.endTz ? 'input-error' : ''}" />
					{#if errors.endTz}<p class="field-error">{errors.endTz}</p>{/if}
				</div>
				<TextField name="location" label="Route label" placeholder="JFK → LHR" class="sm:col-span-2" {errors} />
			</CollapseSection>

			<CollapseSection title="Aircraft and service info" bind:open={aircraftOpen}>
				<TextField name="detail_aircraft" label="Aircraft" placeholder="Boeing 787" class="sm:col-span-2" />
				<TextField name="detail_cabin" label="Cabin / class" placeholder="Economy, business, etc." class="sm:col-span-2" />
				<TextField name="detail_frequentFlyer" label="Frequent flyer #" placeholder="Optional loyalty number" class="sm:col-span-2" />
			</CollapseSection>
		{/if}
	</section>
{/each}

<TextField name="meetingPoint" label="Meeting / rally point" placeholder="e.g. Hotel lobby, gate A12" maxlength="200" class="sm:col-span-2" {errors} />

<TextField name="meetingAt" label="Rally time" type="datetime-local" {errors} />

<div class="sm:col-span-2">
	<button type="button" class="btn btn-ghost" onclick={addFlight}>
		<Icon name="plus" class="h-4 w-4" />
		Add a flight
	</button>
</div>

<TextAreaField name="detail_notes" label="Notes" rows={3} placeholder="Enter note e.g. Don't forget your charger!" class="sm:col-span-2" />

<div class="segment-form-section sm:col-span-2">
	<div class="panel-header">
		<h3 class="section-title">More details</h3>
		<button type="button" class="link text-sm no-underline" onclick={expandAll}>Expand all</button>
	</div>

	<CollapseSection title="Passengers" bind:open={passengersOpen}>
		<TextAreaField name="detail_passengers" label="Passengers" rows={3} placeholder="Passenger names" class="sm:col-span-2" />
	</CollapseSection>

	<BookingInfoSection bind:open={bookingOpen} />
</div>
