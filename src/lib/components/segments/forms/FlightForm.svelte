<script lang="ts">
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import CollapseSection from '../CollapseSection.svelte';
	import BookedCheckbox from '../BookedCheckbox.svelte';
	import BookingInfoSection from '../BookingInfoSection.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();

	let flightCount = $state(1);
	let manualOpen = $state(false);
	let aircraftOpen = $state(false);
	let passengersOpen = $state(false);
	let bookingOpen = $state(true);

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

<div class="field">
	<label class="label" for="confirmationNumber">Confirmation</label>
	<input
		id="confirmationNumber"
		name="confirmationNumber"
		placeholder="Enter confirmation"
		class="input {errors.confirmationNumber ? 'input-error' : ''}"
	/>
	{#if errors.confirmationNumber}<p class="field-error">{errors.confirmationNumber}</p>{/if}
</div>
<div class="field">
	<label class="label" for="detail_totalCost">Total cost</label>
	<input id="detail_totalCost" name="detail_totalCost" placeholder="Enter total cost" class="input" />
</div>

<BookedCheckbox />

{#each Array.from({ length: flightCount }, (_, i) => i) as index (index)}
	<section class="segment-form-section sm:col-span-2">
		<h3 class="section-title mb-4">Flight {index + 1}</h3>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="field">
				<label class="label" for="{flightName(index, 'date')}">Departure date</label>
				<input
					id={flightName(index, 'date')}
					name={flightName(index, 'date')}
					type="date"
					class="input {errors.startDate || errors.localStart ? 'input-error' : ''}"
					required={index === 0}
				/>
				{#if index === 0 && errors.startDate}<p class="field-error">{errors.startDate}</p>{/if}
				{#if index === 0 && errors.localStart}<p class="field-error">{errors.localStart}</p>{/if}
			</div>
			<div class="field">
				<label class="label" for="{flightName(index, 'airline')}">
					Airline{#if index === 0}<span class="text-red-400"> *</span>{/if}
				</label>
				<input
					id={flightName(index, 'airline')}
					name={flightName(index, 'airline')}
					placeholder="Enter airline"
					class="input"
					required={index === 0}
				/>
			</div>

			<div class="field">
				<label class="label" for="{flightName(index, 'number')}">Flight number</label>
				<input
					id={flightName(index, 'number')}
					name={flightName(index, 'number')}
					placeholder="Enter flight number"
					class="input {index === 0 && errors.title ? 'input-error' : ''}"
					required={index === 0}
				/>
				{#if index === 0 && errors.title}<p class="field-error">{errors.title}</p>{/if}
			</div>
			<div class="field">
				<label class="label" for="{flightName(index, 'seats')}">Seats</label>
				<input
					id={flightName(index, 'seats')}
					name={flightName(index, 'seats')}
					placeholder="Enter seats"
					class="input"
				/>
			</div>
		</div>

		{#if index === 0}
			<CollapseSection title="Manually edit flight" bind:open={manualOpen}>
				<div class="field">
					<label class="label" for="detail_departAirport">Departure airport</label>
					<input id="detail_departAirport" name="detail_departAirport" placeholder="JFK" class="input" />
				</div>
				<div class="field">
					<label class="label" for="detail_arriveAirport">Arrival airport</label>
					<input id="detail_arriveAirport" name="detail_arriveAirport" placeholder="LHR" class="input" />
				</div>
				<div class="field">
					<label class="label" for="startTime">Departure time</label>
					<input id="startTime" name="startTime" type="time" class="input" />
				</div>
				<div class="field">
					<label class="label" for="endDate">Arrival date</label>
					<input id="endDate" name="endDate" type="date" class="input {errors.endAt ? 'input-error' : ''}" />
				</div>
				<div class="field">
					<label class="label" for="endTime">Arrival time</label>
					<input id="endTime" name="endTime" type="time" class="input" />
				</div>
				<div class="field sm:col-span-2">
					<label class="label" for="startTz">Timezone</label>
					<TimezoneSelect id="startTz" name="startTz" value="UTC" class="input {errors.startTz ? 'input-error' : ''}" />
					{#if errors.startTz}<p class="field-error">{errors.startTz}</p>{/if}
				</div>
				<div class="field sm:col-span-2">
					<label class="label" for="location">Route label</label>
					<input id="location" name="location" placeholder="JFK → LHR" class="input {errors.location ? 'input-error' : ''}" />
					{#if errors.location}<p class="field-error">{errors.location}</p>{/if}
				</div>
			</CollapseSection>

			<CollapseSection title="Aircraft and service info" bind:open={aircraftOpen}>
				<div class="field sm:col-span-2">
					<label class="label" for="detail_aircraft">Aircraft</label>
					<input id="detail_aircraft" name="detail_aircraft" placeholder="Boeing 787" class="input" />
				</div>
				<div class="field sm:col-span-2">
					<label class="label" for="detail_cabin">Cabin / class</label>
					<input id="detail_cabin" name="detail_cabin" placeholder="Economy, business, etc." class="input" />
				</div>
				<div class="field sm:col-span-2">
					<label class="label" for="detail_frequentFlyer">Frequent flyer #</label>
					<input id="detail_frequentFlyer" name="detail_frequentFlyer" placeholder="Optional loyalty number" class="input" />
				</div>
			</CollapseSection>
		{/if}
	</section>
{/each}

<div class="sm:col-span-2">
	<button type="button" class="btn btn-ghost btn-sm" onclick={addFlight}>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="h-4 w-4"><path d="M5 12h14M12 5v14" /></svg>
		Add a flight
	</button>
</div>

<div class="field sm:col-span-2">
	<label class="label" for="detail_notes">Notes</label>
	<textarea id="detail_notes" name="detail_notes" rows="3" placeholder="Enter note e.g. Don't forget your charger!" class="textarea"></textarea>
</div>

<div class="segment-form-section sm:col-span-2">
	<div class="mb-3 flex items-center justify-between gap-3">
		<h3 class="section-title">More details</h3>
		<button type="button" class="link text-sm no-underline" onclick={expandAll}>Expand all</button>
	</div>

	<CollapseSection title="Passengers" bind:open={passengersOpen}>
		<div class="field sm:col-span-2">
			<label class="label" for="detail_passengers">Passengers</label>
			<textarea id="detail_passengers" name="detail_passengers" rows="3" placeholder="Passenger names" class="textarea"></textarea>
		</div>
	</CollapseSection>

	<BookingInfoSection bind:open={bookingOpen} />
</div>
