<script lang="ts">
	import { m } from '$lib/paraglide/messages';
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

<TextField name="title" label={m.rental_car_agency_label()} placeholder={m.rental_car_agency_placeholder()} required class="sm:col-span-2" {errors} />

<section class="segment-form-section sm:col-span-2">
	<div class="grid gap-4 sm:grid-cols-3">
		<TextField name="startDate" label={m.rental_car_pickup_date_label()} type="date" required errorKey={['startDate', 'localStart']} {errors} />
		<TextField name="startTime" label={m.rental_car_pickup_time_label()} type="time" />
		<div class="field">
			<label class="label" for="startTz">{m.rental_car_pickup_timezone_label()}</label>
			<TimezoneSelect id="startTz" name="startTz" value="UTC" class="input {errors.startTz ? 'input-error' : ''}" />
			{#if errors.startTz}<p class="field-error">{errors.startTz}</p>{/if}
		</div>
		<TextField name="endDate" label={m.rental_car_dropoff_date_label()} type="date" required errorKey={['endDate', 'endAt']} {errors} />
		<TextField name="endTime" label={m.rental_car_dropoff_time_label()} type="time" />
		<div class="field">
			<label class="label" for="endTz">{m.rental_car_dropoff_timezone_label()}</label>
			<TimezoneSelect id="endTz" name="endTz" value="UTC" class="input {errors.endTz ? 'input-error' : ''}" />
			{#if errors.endTz}<p class="field-error">{errors.endTz}</p>{/if}
		</div>
	</div>
</section>

<TextField name="detail_website" label={m.rental_car_website_label()} type="url" placeholder={m.rental_car_website_placeholder()} class="sm:col-span-2" />
<TextField name="detail_email" label={m.rental_car_email_label()} type="email" placeholder={m.rental_car_email_placeholder()} class="sm:col-span-2" />

<TextField name="confirmationNumber" label={m.rental_car_confirmation_label()} placeholder={m.rental_car_confirmation_placeholder()} {errors} />
<TextField name="detail_totalCost" label={m.rental_car_total_cost_label()} placeholder={m.rental_car_total_cost_placeholder()} />

<BookedCheckbox />

<section class="segment-form-section sm:col-span-2">
	<h3 class="section-title mb-4">{m.rental_car_pickup_section()}</h3>
	<TextField name="detail_pickupLocation" label={m.rental_car_pickup_location_label()} placeholder={m.rental_car_pickup_location_placeholder()} class="sm:col-span-2" />
	<TextField name="location" label={m.rental_car_address_label()} placeholder={m.rental_car_address_placeholder()} class="sm:col-span-2" {errors} />
	<TextField name="detail_phone" label={m.rental_car_phone_label()} type="tel" placeholder={m.rental_car_phone_placeholder()} class="sm:col-span-2" />
</section>

<section class="segment-form-section sm:col-span-2">
	<h3 class="section-title mb-4">{m.rental_car_dropoff_section()}</h3>
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
		<label class="label mb-0" for="detail_sameAsPickup">{m.rental_car_same_as_pickup_label()}</label>
	</div>
	{#if !sameAsPickup}
		<TextField name="detail_dropoffLocation" label={m.rental_car_dropoff_location_label()} placeholder={m.rental_car_dropoff_location_placeholder()} class="sm:col-span-2" />
		<TextField name="detail_dropoffAddress" label={m.rental_car_address_label()} placeholder={m.rental_car_address_placeholder()} class="sm:col-span-2" />
		<TextField name="detail_dropoffPhone" label={m.rental_car_phone_label()} type="tel" placeholder={m.rental_car_phone_placeholder()} class="sm:col-span-2" />
	{/if}
</section>

<section class="segment-form-section sm:col-span-2">
	<h3 class="section-title mb-4">{m.rental_car_info_section()}</h3>
	<TextField name="detail_carType" label={m.rental_car_car_type_label()} placeholder={m.rental_car_car_type_placeholder()} class="sm:col-span-2" />
	<TextField name="detail_mileageCharges" label={m.rental_car_mileage_charges_label()} placeholder={m.rental_car_mileage_charges_placeholder()} class="sm:col-span-2" />
	<TextAreaField name="detail_carDetails" label={m.rental_car_car_details_label()} rows={3} placeholder={m.rental_car_car_details_placeholder()} class="sm:col-span-2" />
</section>

<TextField name="meetingPoint" label={m.rental_car_meeting_point_label()} placeholder={m.rental_car_meeting_point_placeholder()} maxlength="200" class="sm:col-span-2" {errors} />

<TextField name="meetingAt" label={m.rental_car_rally_time_label()} type="datetime-local" {errors} />

<TextAreaField name="detail_notes" label={m.rental_car_notes_label()} rows={3} placeholder={m.rental_car_notes_placeholder()} class="sm:col-span-2" />

<div class="segment-form-section sm:col-span-2">
	<div class="panel-header">
		<h3 class="section-title">{m.rental_car_more_details_section()}</h3>
		<button type="button" class="link text-sm no-underline" onclick={expandAll}>{m.rental_car_expand_all()}</button>
	</div>

	<CollapseSection title={m.rental_car_drivers_section()} bind:open={driversOpen}>
		<TextAreaField name="detail_drivers" label={m.rental_car_drivers_section()} rows={3} placeholder={m.rental_car_drivers_placeholder()} class="sm:col-span-2" />
	</CollapseSection>

	<BookingInfoSection bind:open={bookingOpen} />
</div>
