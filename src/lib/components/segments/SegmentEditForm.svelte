<script lang="ts">
	import CancelButton from '$lib/components/CancelButton.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import SelectField from '$lib/components/SelectField.svelte';
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import CityAutocomplete from './CityAutocomplete.svelte';
	import Admin1Select from '$lib/components/Admin1Select.svelte';
	import CardSelect from '$lib/components/CardSelect.svelte';
	import { toDatetimeLocal } from '$lib/segments/datetimeLocal';
	import { COUNTRIES } from '$lib/countries';
	import { usesPickupDropoff } from '$lib/segmentLabels';
	import TripDocumentsTable from '$lib/components/TripDocumentsTable.svelte';
	import { m } from '$lib/paraglide/messages';

	interface SegmentEdit {
		id?: number;
		type: string;
		title: string;
		startAt?: string | null;
		startTz: string;
		endAt?: string | null;
		endTz?: string | null;
		meetingAt?: string | null;
		meetingPoint?: string | null;
		countryCode?: string | null;
		admin1Code?: string | null;
		cityName?: string | null;
		cityLat?: number | null;
		cityLng?: number | null;
		venue?: string | null;
		confirmationNumber?: string | null;
		paymentStatus?: string | null;
		paymentDueDate?: string | null;
		detailsJson?: string | null;
		cardId?: number | null;
	}

	interface SegmentDocument {
		id: number;
		label?: string | null;
		filename: string;
		contentType?: string | null;
		sizeBytes: number;
	}

	let {
		segment: s,
		tripId,
		errors = {},
		cards = [],
		documents = [],
		onCancel
	}: {
		segment: SegmentEdit;
		tripId: number;
		errors?: Record<string, string>;
		cards?: { id: number; nickname: string; network: string; last4: string | null }[];
		documents?: SegmentDocument[];
		onCancel: () => void;
	} = $props();

	const fid = (k: string) => `${k}-${s.id ?? ''}`;
	const hotel = $derived(s.type === 'hotel');
	const flight = $derived(s.type === 'flight');
	const pickupDropoff = $derived(usesPickupDropoff(s.type));

	let countryCode = $derived(s.countryCode ?? '');
	let admin1Code = $derived(s.admin1Code ?? '');
	let isDirty = $state(false);
</script>

<form method="POST" action={`/trips/${tripId}/segments?/update`} class="trip-timeline-card grid gap-4 sm:grid-cols-2" oninput={() => (isDirty = true)}>
	<input type="hidden" name="segmentId" value={s.id} />
	<TextField name="title" id={fid('title')} label={m.plan_title_label()} value={s.title} required {errors} />
	<TextField name="localStart" id={fid('localStart')} label={hotel ? m.segment_edit_checkin_label() : flight ? m.segment_edit_departure_label() : pickupDropoff ? m.segment_edit_pickup_label() : m.segment_edit_starts_label()} type="datetime-local" value={toDatetimeLocal(s.startAt, s.startTz)} required {errors} />
	<div class="field">
		<label class="label" for={fid('startTz')}>{m.datetime_timezone_label()}</label>
		<TimezoneSelect id={fid('startTz')} name="startTz" value={s.startTz} class="input {errors.startTz ? 'input-error' : ''}" />
		{#if errors.startTz}<p class="field-error">{errors.startTz}</p>{/if}
	</div>
	<TextField name="endAt" id={fid('endAt')} label={hotel ? m.segment_edit_checkout_label() : flight ? m.segment_edit_arrival_label() : pickupDropoff ? m.segment_edit_dropoff_label() : m.segment_edit_ends_label()} type="datetime-local" value={toDatetimeLocal(s.endAt, s.endTz ?? s.startTz)} {errors} />
	<div class="field">
		<label class="label" for={fid('endTz')}>{hotel ? m.hotel_checkout_timezone_label() : flight ? m.flight_arrival_timezone_label() : pickupDropoff ? m.rental_car_dropoff_timezone_label() : m.datetime_end_timezone_label()}</label>
		<TimezoneSelect id={fid('endTz')} name="endTz" value={s.endTz ?? s.startTz} class="input {errors.endTz ? 'input-error' : ''}" />
		{#if errors.endTz}<p class="field-error">{errors.endTz}</p>{/if}
	</div>
	<div class="field">
		<label class="label" for={fid('countryCode')}>{m.plan_country_label()}</label>
		<select
			id={fid('countryCode')}
			name="countryCode"
			class="input {errors.countryCode ? 'input-error' : ''}"
			bind:value={countryCode}
		>
			<option value="">{m.plan_country_placeholder()}</option>
			{#each COUNTRIES as c (c.code)}
				<option value={c.code}>{c.name}</option>
			{/each}
		</select>
		{#if errors.countryCode}<p class="field-error">{errors.countryCode}</p>{/if}
	</div>
	<Admin1Select
		{countryCode}
		name="admin1Code"
		id={fid('admin1Code')}
		bind:value={admin1Code}
		{errors}
	/>
	<CityAutocomplete
		{countryCode}
		{admin1Code}
		name="cityName"
		value={s.cityName ?? ''}
		lat={s.cityLat ?? null}
		lng={s.cityLng ?? null}
		latName="cityLat"
		lngName="cityLng"
		{errors}
	/>
	<TextField name="venue" id={fid('venue')} label={hotel ? m.hotel_address_label() : m.plan_location_label()} value={s.venue ?? ''} class="sm:col-span-2" {errors} />
	<TextField name="confirmationNumber" id={fid('confirmationNumber')} label={m.segment_edit_confirmation_label()} value={s.confirmationNumber ?? ''} {errors} />
	<TextField name="meetingPoint" id={fid('meetingPoint')} label={m.plan_meeting_point_label()} value={s.meetingPoint ?? ''} maxlength="200" class="sm:col-span-2" {errors} />
	<TextField name="meetingAt" id={fid('meetingAt')} label={m.plan_rally_time_label()} type="datetime-local" value={toDatetimeLocal(s.meetingAt, s.startTz ?? 'UTC')} {errors} />
	<SelectField name="paymentStatus" id={fid('paymentStatus')} label={m.segment_edit_payment_status_label()} {errors}>
		<option value="quoted" selected={s.paymentStatus === 'quoted'}>{m.segment_edit_payment_status_quoted()}</option>
		<option value="deposit_paid" selected={s.paymentStatus === 'deposit_paid'}>{m.segment_edit_payment_status_deposit_paid()}</option>
		<option value="fully_paid" selected={s.paymentStatus === 'fully_paid'}>{m.segment_edit_payment_status_fully_paid()}</option>
		<option value="refunded" selected={s.paymentStatus === 'refunded'}>{m.segment_edit_payment_status_refunded()}</option>
	</SelectField>
	<TextField name="paymentDueDate" id={fid('paymentDueDate')} label={m.segment_edit_payment_due_label()} type="date" value={s.paymentDueDate ?? ''} {errors} />
	{#if s.id != null}
		<details class="panel-subtle sm:col-span-2" open={documents.length > 0}>
			<summary class="cursor-pointer font-semibold">{m.segment_edit_attached_files_section()}</summary>
			<div class="mt-3 space-y-3">
				<p class="text-sm text-muted">{m.segment_edit_attached_files_hint()}</p>
				<TripDocumentsTable
					{tripId}
					{documents}
					canEdit={true}
					pageSize={5}
					showScope={false}
					emptyMessage={m.segment_edit_no_files()}
				/>
				<!-- Inputs associate to a sibling form via the form= attribute (no nested forms). -->
				<div class="grid gap-2 sm:grid-cols-2">
					<input
						id={fid('attach-file')}
						form="segment-file-upload-{s.id}"
						type="file"
						name="file"
						accept="image/jpeg,image/png,image/webp,application/pdf,.gpx,application/gpx+xml"
						class="input text-sm sm:col-span-2"
						required
					/>
					<input
						form="segment-file-upload-{s.id}"
						name="label"
						class="input text-sm"
						placeholder={m.segment_edit_label_placeholder()}
					/>
					<button form="segment-file-upload-{s.id}" type="submit" class="btn btn-secondary btn-sm">
						{m.segment_edit_upload_file()}
					</button>
				</div>
			</div>
		</details>
	{/if}
	<details class="panel-subtle sm:col-span-2" open={Boolean(errors.detailsJson)}>
		<summary class="cursor-pointer font-semibold">{m.segment_edit_more_details_section()}</summary>
		<div class="field mt-3">
			<label class="label" for={fid('detailsJson')}>{m.segment_edit_stored_data_label()}</label>
			<p class="mb-2 text-sm text-muted">{m.segment_edit_stored_data_hint()}</p>
			<textarea id={fid('detailsJson')} name="detailsJson" class="input h-20 font-mono text-xs {errors.detailsJson ? 'input-error' : ''}">{s.detailsJson ?? ''}</textarea>
			{#if errors.detailsJson}<p class="field-error">{errors.detailsJson}</p>{/if}
		</div>
	</details>
	{#if cards?.length}
		<CardSelect {cards} name="cardId" value={s.cardId} {errors} />
	{/if}
	<div class="flex justify-end gap-2 sm:col-span-2">
		<CancelButton dirty={isDirty} onConfirm={onCancel}>{m.common_cancel()}</CancelButton>
		<button class="btn btn-primary">{m.segment_new_save()}</button>
	</div>
</form>
{#if s.id != null}
	<form
		id="segment-file-upload-{s.id}"
		method="POST"
		action={`/trips/${tripId}?/uploadTripDocument`}
		enctype="multipart/form-data"
		class="hidden"
		aria-hidden="true"
	>
		<input type="hidden" name="segmentId" value={s.id} />
	</form>
{/if}
