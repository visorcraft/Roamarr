<script lang="ts">
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import CollapseSection from '../CollapseSection.svelte';
	import BookedCheckbox from '../BookedCheckbox.svelte';
	import BookingInfoSection from '../BookingInfoSection.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';

	let { errors = {} }: { errors?: Record<string, string> } = $props();

	let sameAsPickup = $state(true);
	let driversOpen = $state(false);
	let bookingOpen = $state(true);

	function expandAll() {
		driversOpen = true;
		bookingOpen = true;
	}
</script>

<TextField name="title" label="Rental agency" placeholder="Enter rental agency" required class="sm:col-span-2" {errors} />

<section class="segment-form-section sm:col-span-2">
	<div class="grid gap-4 sm:grid-cols-3">
		<TextField name="startDate" label="Pick-up date" type="date" required errorKey={['startDate', 'localStart']} {errors} />
		<TextField name="startTime" label="Pick-up time" type="time" />
		<div class="field">
			<label class="label" for="startTz">Timezone</label>
			<TimezoneSelect id="startTz" name="startTz" value="UTC" class="input {errors.startTz ? 'input-error' : ''}" />
			{#if errors.startTz}<p class="field-error">{errors.startTz}</p>{/if}
		</div>
		<TextField name="endDate" label="Drop-off date" type="date" required errorKey={['endDate', 'endAt']} {errors} />
		<TextField name="endTime" label="Drop-off time" type="time" />
		<div class="field">
			<label class="label" for="endTz">Drop-off timezone</label>
			<TimezoneSelect id="endTz" name="endTz" value="UTC" class="input {errors.endTz ? 'input-error' : ''}" />
			{#if errors.endTz}<p class="field-error">{errors.endTz}</p>{/if}
		</div>
	</div>
</section>

<TextField name="detail_website" label="Website" type="url" placeholder="Enter website" class="sm:col-span-2" />
<TextField name="detail_email" label="Email" type="email" placeholder="Enter email" class="sm:col-span-2" />

<TextField name="confirmationNumber" label="Confirmation" placeholder="Enter confirmation" {errors} />
<TextField name="detail_totalCost" label="Total cost" placeholder="Enter total cost" />

<BookedCheckbox />

<section class="segment-form-section sm:col-span-2">
	<h3 class="section-title mb-4">Pickup</h3>
	<TextField name="detail_pickupLocation" label="Pickup location" placeholder="Enter pickup location" class="sm:col-span-2" />
	<TextField name="location" label="Address" placeholder="Enter address" class="sm:col-span-2" {errors} />
	<TextField name="detail_phone" label="Phone" type="tel" placeholder="Enter phone" class="sm:col-span-2" />
</section>

<section class="segment-form-section sm:col-span-2">
	<h3 class="section-title mb-4">Drop-off</h3>
	<div class="field flex flex-row items-center gap-2 sm:col-span-2">
		<input
			id="detail_sameAsPickup"
			name="detail_sameAsPickup"
			type="checkbox"
			class="checkbox"
			checked={sameAsPickup}
			onchange={(event) => {
				sameAsPickup = event.currentTarget.checked;
			}}
		/>
		<label class="label mb-0" for="detail_sameAsPickup">Same as pickup location</label>
	</div>
	{#if !sameAsPickup}
		<TextField name="detail_dropoffLocation" label="Drop-off location" placeholder="Enter drop-off location" class="sm:col-span-2" />
		<TextField name="detail_dropoffAddress" label="Address" placeholder="Enter address" class="sm:col-span-2" />
		<TextField name="detail_dropoffPhone" label="Phone" type="tel" placeholder="Enter phone" class="sm:col-span-2" />
	{/if}
</section>

<section class="segment-form-section sm:col-span-2">
	<h3 class="section-title mb-4">Rental info</h3>
	<TextField name="detail_carType" label="Car type" placeholder="Enter car type" class="sm:col-span-2" />
	<TextField name="detail_mileageCharges" label="Mileage charges" placeholder="Enter mileage charges" class="sm:col-span-2" />
	<TextAreaField name="detail_carDetails" label="Car details" rows={3} placeholder="Enter car details" class="sm:col-span-2" />
</section>

<TextField name="meetingPoint" label="Meeting / rally point" placeholder="e.g. Rental counter, hotel lobby" maxlength="200" class="sm:col-span-2" {errors} />

<TextField name="meetingAt" label="Rally time" type="datetime-local" {errors} />

<TextAreaField name="detail_notes" label="Notes" rows={3} placeholder="Enter note e.g. Don't forget your charger!" class="sm:col-span-2" />

<div class="segment-form-section sm:col-span-2">
	<div class="panel-header">
		<h3 class="section-title">More details</h3>
		<button type="button" class="link text-sm no-underline" onclick={expandAll}>Expand all</button>
	</div>

	<CollapseSection title="Drivers" bind:open={driversOpen}>
		<TextAreaField name="detail_drivers" label="Drivers" rows={3} placeholder="Driver names" class="sm:col-span-2" />
	</CollapseSection>

	<BookingInfoSection bind:open={bookingOpen} />
</div>
