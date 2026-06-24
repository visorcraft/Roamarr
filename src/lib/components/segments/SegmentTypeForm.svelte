<script lang="ts">
	import type { SegmentType } from '$lib/segmentLabels';
	import DateTimeRangeFields from './DateTimeRangeFields.svelte';
	import EventForm from './forms/EventForm.svelte';
	import FlightForm from './forms/FlightForm.svelte';
	import NoteForm from './forms/NoteForm.svelte';
	import ParkingForm from './forms/ParkingForm.svelte';
	import RentalCarForm from './forms/RentalCarForm.svelte';
	import TodoForm from './forms/TodoForm.svelte';
	import StandardPlanForm from './forms/StandardPlanForm.svelte';

	let { type, errors = {} }: { type: SegmentType; errors?: Record<string, string> } = $props();
</script>

{#if type === 'event'}
	<EventForm {errors} />
{:else if type === 'flight'}
	<FlightForm {errors} />
{:else if type === 'rental_car'}
	<RentalCarForm {errors} />
{:else if type === 'hotel'}
	<StandardPlanForm
		{errors}
		titleLabel="Hotel name"
		titlePlaceholder="Grand Hotel"
		locationLabel="Address"
		locationPlaceholder="Enter address"
		requireEnd={true}
	/>
	<div class="field sm:col-span-2">
		<label class="label" for="detail_phone">Phone</label>
		<input id="detail_phone" name="detail_phone" type="tel" placeholder="Hotel phone" class="input" />
	</div>
{:else if type === 'note'}
	<NoteForm {errors} />
{:else if type === 'todo'}
	<TodoForm {errors} />
{:else if type === 'parking'}
	<ParkingForm {errors} />
{:else if type === 'boat'}
	<StandardPlanForm
		{errors}
		titleLabel="Cruise / ferry name"
		titlePlaceholder="Harbor ferry"
		locationLabel="Port / pier"
		locationPlaceholder="Pier 33"
		requireEnd={true}
	/>
{:else if type === 'train'}
	<StandardPlanForm
		{errors}
		titleLabel="Train"
		titlePlaceholder="Amtrak 123"
		locationLabel="Route"
		locationPlaceholder="Boston → New York"
	/>
	<div class="field sm:col-span-2">
		<label class="label" for="detail_seat">Seat / car</label>
		<input id="detail_seat" name="detail_seat" placeholder="Car 7, Seat 42" class="input" />
	</div>
{:else if type === 'directions'}
	<div class="field sm:col-span-2">
		<label class="label" for="title">Directions title</label>
		<input id="title" name="title" placeholder="Drive to hotel" class="input {errors.title ? 'input-error' : ''}" required />
		{#if errors.title}<p class="field-error">{errors.title}</p>{/if}
	</div>
	<DateTimeRangeFields {errors} idPrefix="directions" />
	<div class="field sm:col-span-2">
		<label class="label" for="detail_from">From</label>
		<input id="detail_from" name="detail_from" placeholder="Starting point" class="input" />
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="location">To</label>
		<input id="location" name="location" placeholder="Destination" class="input {errors.location ? 'input-error' : ''}" />
		{#if errors.location}<p class="field-error">{errors.location}</p>{/if}
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="detail_notes">Notes</label>
		<textarea id="detail_notes" name="detail_notes" rows="3" placeholder="Turn-by-turn notes" class="textarea"></textarea>
	</div>
{:else if type === 'food'}
	<StandardPlanForm
		{errors}
		titleLabel="Restaurant"
		titlePlaceholder="Dinner reservation"
		locationLabel="Address"
		locationPlaceholder="Restaurant address"
	/>
	<div class="field">
		<label class="label" for="detail_partySize">Party size</label>
		<input id="detail_partySize" name="detail_partySize" placeholder="2" class="input" />
	</div>
{:else if type === 'poi'}
	<StandardPlanForm
		{errors}
		titleLabel="Place name"
		titlePlaceholder="Eiffel Tower"
		locationLabel="Address"
		locationPlaceholder="Enter address"
	/>
{:else if type === 'meetup'}
	<StandardPlanForm
		{errors}
		titleLabel="Meet up title"
		titlePlaceholder="Coffee with Alex"
		locationLabel="Meeting place"
		locationPlaceholder="Cafe address or landmark"
		requireEnd={true}
	/>
	<div class="field sm:col-span-2">
		<label class="label" for="detail_attendees">Who</label>
		<input id="detail_attendees" name="detail_attendees" placeholder="Names or group" class="input" />
	</div>
{:else if type === 'rideshare'}
	<StandardPlanForm
		{errors}
		titleLabel="Service"
		titlePlaceholder="Uber / Lyft"
		locationLabel="Pickup"
		locationPlaceholder="Pickup address"
	/>
	<div class="field sm:col-span-2">
		<label class="label" for="detail_dropoff">Drop-off</label>
		<input id="detail_dropoff" name="detail_dropoff" placeholder="Drop-off address" class="input" />
	</div>
{:else if type === 'shuttle'}
	<StandardPlanForm
		{errors}
		titleLabel="Shuttle service"
		titlePlaceholder="Airport shuttle"
		locationLabel="Pickup"
		locationPlaceholder="Pickup location"
		requireEnd={true}
	/>
	<div class="field sm:col-span-2">
		<label class="label" for="detail_dropoff">Drop-off</label>
		<input id="detail_dropoff" name="detail_dropoff" placeholder="Drop-off location" class="input" />
	</div>
{/if}
