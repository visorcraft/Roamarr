<script lang="ts">
	import CancelButton from '$lib/components/CancelButton.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import SelectField from '$lib/components/SelectField.svelte';
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import CityAutocomplete from './CityAutocomplete.svelte';
	import CardSelect from '$lib/components/CardSelect.svelte';
	import { toDatetimeLocal } from '$lib/segments/datetimeLocal';
	import { COUNTRIES } from '$lib/countries';
	import { usesPickupDropoff } from '$lib/segmentLabels';

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
		cityName?: string | null;
		venue?: string | null;
		confirmationNumber?: string | null;
		paymentStatus?: string | null;
		paymentDueDate?: string | null;
		detailsJson?: string | null;
		cardId?: number | null;
	}

	let {
		segment: s,
		tripId,
		errors = {},
		cards = [],
		onCancel
	}: {
		segment: SegmentEdit;
		tripId: number;
		errors?: Record<string, string>;
		cards?: { id: number; nickname: string; network: string; last4: string | null }[];
		onCancel: () => void;
	} = $props();

	const fid = (k: string) => `${k}-${s.id ?? ''}`;
	const hotel = $derived(s.type === 'hotel');
	const flight = $derived(s.type === 'flight');
	const pickupDropoff = $derived(usesPickupDropoff(s.type));

	let isDirty = $state(false);
</script>

<form method="POST" action={`/trips/${tripId}/segments?/update`} class="trip-timeline-card grid gap-4 sm:grid-cols-2" oninput={() => (isDirty = true)}>
	<input type="hidden" name="segmentId" value={s.id} />
	<TextField name="title" id={fid('title')} label="Title" value={s.title} required {errors} />
	<TextField name="localStart" id={fid('localStart')} label={hotel ? 'Check-in' : flight ? 'Departure' : pickupDropoff ? 'Pick-up' : 'Starts'} type="datetime-local" value={toDatetimeLocal(s.startAt, s.startTz)} required {errors} />
	<div class="field">
		<label class="label" for={fid('startTz')}>Timezone</label>
		<TimezoneSelect id={fid('startTz')} name="startTz" value={s.startTz} class="input {errors.startTz ? 'input-error' : ''}" />
		{#if errors.startTz}<p class="field-error">{errors.startTz}</p>{/if}
	</div>
	<TextField name="endAt" id={fid('endAt')} label={hotel ? 'Check-out' : flight ? 'Arrival' : pickupDropoff ? 'Drop-off' : 'Ends'} type="datetime-local" value={toDatetimeLocal(s.endAt, s.endTz ?? s.startTz)} {errors} />
	<div class="field">
		<label class="label" for={fid('endTz')}>{hotel ? 'Check-out timezone' : flight ? 'Arrival timezone' : pickupDropoff ? 'Drop-off timezone' : 'End timezone'}</label>
		<TimezoneSelect id={fid('endTz')} name="endTz" value={s.endTz ?? s.startTz} class="input {errors.endTz ? 'input-error' : ''}" />
		{#if errors.endTz}<p class="field-error">{errors.endTz}</p>{/if}
	</div>
	<SelectField name="countryCode" id={fid('countryCode')} label="Country" {errors}>
		<option value="" selected={!s.countryCode}>Select country</option>
		{#each COUNTRIES as c (c.code)}
			<option value={c.code} selected={c.code === s.countryCode}>{c.name}</option>
		{/each}
	</SelectField>
	<CityAutocomplete countryCode={s.countryCode ?? ''} name="cityName" value={s.cityName ?? ''} latName="cityLat" lngName="cityLng" {errors} />
	<TextField name="venue" id={fid('venue')} label={hotel ? 'Address' : 'Venue'} value={s.venue ?? ''} class="sm:col-span-2" {errors} />
	<TextField name="confirmationNumber" id={fid('confirmationNumber')} label="Confirmation #" value={s.confirmationNumber ?? ''} {errors} />
	<TextField name="meetingPoint" id={fid('meetingPoint')} label="Meeting / rally point" value={s.meetingPoint ?? ''} maxlength="200" class="sm:col-span-2" {errors} />
	<TextField name="meetingAt" id={fid('meetingAt')} label="Rally time" type="datetime-local" value={toDatetimeLocal(s.meetingAt, s.startTz ?? 'UTC')} {errors} />
	<SelectField name="paymentStatus" id={fid('paymentStatus')} label="Payment status" {errors}>
		<option value="quoted" selected={s.paymentStatus === 'quoted'}>Quoted</option>
		<option value="deposit_paid" selected={s.paymentStatus === 'deposit_paid'}>Deposit paid</option>
		<option value="fully_paid" selected={s.paymentStatus === 'fully_paid'}>Fully paid</option>
		<option value="refunded" selected={s.paymentStatus === 'refunded'}>Refunded</option>
	</SelectField>
	<TextField name="paymentDueDate" id={fid('paymentDueDate')} label="Payment due" type="date" value={s.paymentDueDate ?? ''} {errors} />
	<div class="field sm:col-span-2">
		<label class="label" for={fid('detailsJson')}>Details (JSON)</label>
		<textarea id={fid('detailsJson')} name="detailsJson" class="input h-20 font-mono text-xs {errors.detailsJson ? 'input-error' : ''}">{s.detailsJson ?? ''}</textarea>
		{#if errors.detailsJson}<p class="field-error">{errors.detailsJson}</p>{/if}
	</div>
	{#if cards?.length}
		<CardSelect {cards} name="cardId" value={s.cardId} {errors} />
	{/if}
	<div class="flex justify-end gap-2 sm:col-span-2">
		<CancelButton dirty={isDirty} onConfirm={onCancel}>Cancel</CancelButton>
		<button class="btn btn-primary">Save</button>
	</div>
</form>
