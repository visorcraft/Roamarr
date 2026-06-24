<script lang="ts">
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import CollapseSection from '../CollapseSection.svelte';
	import BookedCheckbox from '../BookedCheckbox.svelte';
	import BookingInfoSection from '../BookingInfoSection.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();

	let sameAsPickup = $state(true);
	let driversOpen = $state(false);
	let bookingOpen = $state(true);

	function expandAll() {
		driversOpen = true;
		bookingOpen = true;
	}
</script>

<div class="field sm:col-span-2">
	<label class="label" for="title">Rental agency</label>
	<input
		id="title"
		name="title"
		placeholder="Enter rental agency"
		class="input {errors.title ? 'input-error' : ''}"
		required
	/>
	{#if errors.title}<p class="field-error">{errors.title}</p>{/if}
</div>

<section class="segment-form-section sm:col-span-2">
	<div class="grid gap-4 sm:grid-cols-3">
		<div class="field">
			<label class="label" for="startDate">
				Pickup date<span class="text-red-400"> *</span>
			</label>
			<input
				id="startDate"
				name="startDate"
				type="date"
				class="input {errors.startDate || errors.localStart ? 'input-error' : ''}"
				required
			/>
			{#if errors.startDate}<p class="field-error">{errors.startDate}</p>{/if}
			{#if errors.localStart}<p class="field-error">{errors.localStart}</p>{/if}
		</div>
		<div class="field">
			<label class="label" for="startTime">Pickup time</label>
			<input id="startTime" name="startTime" type="time" class="input" />
		</div>
		<div class="field">
			<label class="label" for="startTz">Timezone</label>
			<TimezoneSelect id="startTz" name="startTz" value="UTC" class="input {errors.startTz ? 'input-error' : ''}" />
			{#if errors.startTz}<p class="field-error">{errors.startTz}</p>{/if}
		</div>

		<div class="field">
			<label class="label" for="endDate">
				Drop-off date<span class="text-red-400"> *</span>
			</label>
			<input
				id="endDate"
				name="endDate"
				type="date"
				class="input {errors.endDate || errors.endAt ? 'input-error' : ''}"
				required
			/>
			{#if errors.endDate}<p class="field-error">{errors.endDate}</p>{/if}
			{#if errors.endAt}<p class="field-error">{errors.endAt}</p>{/if}
		</div>
		<div class="field">
			<label class="label" for="endTime">Drop-off time</label>
			<input id="endTime" name="endTime" type="time" class="input" />
		</div>
		<div class="field">
			<label class="label" for="detail_endTz">Timezone</label>
			<TimezoneSelect id="detail_endTz" name="detail_endTz" value="UTC" class="input" />
		</div>
	</div>
</section>

<div class="field sm:col-span-2">
	<label class="label" for="detail_website">Website</label>
	<input id="detail_website" name="detail_website" type="url" placeholder="Enter website" class="input" />
</div>
<div class="field sm:col-span-2">
	<label class="label" for="detail_email">Email</label>
	<input id="detail_email" name="detail_email" type="email" placeholder="Enter email" class="input" />
</div>

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

<section class="segment-form-section sm:col-span-2">
	<h3 class="section-title mb-4">Pickup</h3>
	<div class="field sm:col-span-2">
		<label class="label" for="detail_pickupLocation">Pickup location</label>
		<input id="detail_pickupLocation" name="detail_pickupLocation" placeholder="Enter pickup location" class="input" />
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="location">Address</label>
		<input
			id="location"
			name="location"
			placeholder="Enter address"
			class="input {errors.location ? 'input-error' : ''}"
		/>
		{#if errors.location}<p class="field-error">{errors.location}</p>{/if}
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="detail_phone">Phone</label>
		<input id="detail_phone" name="detail_phone" type="tel" placeholder="Enter phone" class="input" />
	</div>
</section>

<section class="segment-form-section sm:col-span-2">
	<h3 class="section-title mb-4">Drop-off</h3>
	<div class="field flex flex-row items-center gap-2 sm:col-span-2">
		<input
			id="detail_sameAsPickup"
			name="detail_sameAsPickup"
			type="checkbox"
			class="h-4 w-4"
			checked={sameAsPickup}
			onchange={(event) => {
				sameAsPickup = event.currentTarget.checked;
			}}
		/>
		<label class="label mb-0" for="detail_sameAsPickup">Same as pickup location</label>
	</div>
	{#if !sameAsPickup}
		<div class="field sm:col-span-2">
			<label class="label" for="detail_dropoffLocation">Drop-off location</label>
			<input
				id="detail_dropoffLocation"
				name="detail_dropoffLocation"
				placeholder="Enter drop-off location"
				class="input"
			/>
		</div>
		<div class="field sm:col-span-2">
			<label class="label" for="detail_dropoffAddress">Address</label>
			<input id="detail_dropoffAddress" name="detail_dropoffAddress" placeholder="Enter address" class="input" />
		</div>
		<div class="field sm:col-span-2">
			<label class="label" for="detail_dropoffPhone">Phone</label>
			<input id="detail_dropoffPhone" name="detail_dropoffPhone" type="tel" placeholder="Enter phone" class="input" />
		</div>
	{/if}
</section>

<section class="segment-form-section sm:col-span-2">
	<h3 class="section-title mb-4">Rental info</h3>
	<div class="field sm:col-span-2">
		<label class="label" for="detail_carType">Car type</label>
		<input id="detail_carType" name="detail_carType" placeholder="Enter car type" class="input" />
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="detail_mileageCharges">Mileage charges</label>
		<input id="detail_mileageCharges" name="detail_mileageCharges" placeholder="Enter mileage charges" class="input" />
	</div>
	<div class="field sm:col-span-2">
		<label class="label" for="detail_carDetails">Car details</label>
		<textarea id="detail_carDetails" name="detail_carDetails" rows="3" placeholder="Enter car details" class="textarea"></textarea>
	</div>
</section>

<div class="field sm:col-span-2">
	<label class="label" for="detail_notes">Notes</label>
	<textarea id="detail_notes" name="detail_notes" rows="3" placeholder="Enter note e.g. Don't forget your charger!" class="textarea"></textarea>
</div>

<div class="segment-form-section sm:col-span-2">
	<div class="mb-3 flex items-center justify-between gap-3">
		<h3 class="section-title">More details</h3>
		<button type="button" class="link text-sm no-underline" onclick={expandAll}>Expand all</button>
	</div>

	<CollapseSection title="Drivers" bind:open={driversOpen}>
		<div class="field sm:col-span-2">
			<label class="label" for="detail_drivers">Drivers</label>
			<textarea id="detail_drivers" name="detail_drivers" rows="3" placeholder="Driver names" class="textarea"></textarea>
		</div>
	</CollapseSection>

	<BookingInfoSection bind:open={bookingOpen} />
</div>
