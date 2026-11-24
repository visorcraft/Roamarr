import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import { m } from '$lib/paraglide/messages';
import SegmentEditForm from './SegmentEditForm.svelte';

const segment = {
	id: 42, type: 'flight', title: 'Flight to Lisbon', startAt: '2026-08-01T09:00:00Z', startTz: 'UTC',
	endAt: '2026-08-01T13:00:00Z', endTz: 'UTC', meetingAt: null, meetingPoint: 'Gate A12',
	countryCode: 'PT', cityName: 'Lisbon', venue: 'LIS', confirmationNumber: 'ABC123',
	paymentStatus: 'deposit_paid', paymentDueDate: '2026-07-15', detailsJson: '{}', cardId: null
};

// Safety net for the SegmentEditForm extraction + field-component migration:
// locks field names/ids and the per-segment dynamic id convention.
test('SegmentEditForm renders all expected fields with per-segment ids', () => {
	const { body } = render(SegmentEditForm, { props: { segment, tripId: 7, onCancel: () => {} } });
	for (const f of ['segmentId', 'title', 'localStart', 'startTz', 'endAt', 'endTz', 'countryCode', 'cityName', 'cityLat', 'cityLng', 'venue', 'confirmationNumber', 'meetingPoint', 'meetingAt', 'paymentStatus', 'paymentDueDate', 'detailsJson']) {
		expect(body, `expected name="${f}"`).toContain(`name="${f}"`);
	}
	// dynamic per-segment ids
	expect(body).toContain('id="title-42"');
	expect(body).toContain('id="confirmationNumber-42"');
	// values populate
	expect(body).toContain('value="ABC123"');
	// form posts to the update action for the right trip
	expect(body).toContain('action="/trips/7/segments?/update"');
	expect(body).toContain('Additional details');
	expect(body).not.toContain('Details (JSON)');
});

test('SegmentEditForm renders card select when cards are provided', () => {
	const { body } = render(SegmentEditForm, {
		props: { segment, tripId: 7, cards: [{ id: 1, nickname: 'Visa', network: 'visa', last4: '4242' }], onCancel: () => {} }
	});
	expect(body).toContain('name="cardId"');
});

test('SegmentEditForm shows validation errors', () => {
	const { body } = render(SegmentEditForm, {
		props: { segment, tripId: 7, errors: { title: 'Name it.', endAt: 'Bad end.' }, onCancel: () => {} }
	});
	expect(body).toContain('Name it.');
	expect(body).toContain('Bad end.');
});

test('SegmentEditForm shows Attached files accordion above Additional details', () => {
	const { body } = render(SegmentEditForm, {
		props: {
			segment,
			tripId: 7,
			documents: [{ id: 9, label: 'Voucher QR', filename: 'qr.png', sizeBytes: 1200 }],
			onCancel: () => {}
		}
	});
	expect(body).toContain('Attached files');
	expect(body).toContain('Upload file');
	expect(body).toContain('trip-documents-table');
	const attachedAt = body.indexOf('Attached files');
	const additionalAt = body.indexOf('Additional details');
	expect(attachedAt).toBeGreaterThan(-1);
	expect(additionalAt).toBeGreaterThan(attachedAt);
});

test('SegmentEditForm uses hotel check-in and check-out labels', () => {
	const { body } = render(SegmentEditForm, { props: { segment: { ...segment, type: 'hotel' }, tripId: 7, onCancel: () => {} } });
	expect(body).toContain('Check-in');
	expect(body).toContain('Check-out');
	expect(body).not.toContain('>Ends<');
});

test('SegmentEditForm uses flight departure and arrival labels', () => {
	const { body } = render(SegmentEditForm, { props: { segment, tripId: 7, onCancel: () => {} } });
	expect(body).toContain('Departure');
	expect(body).toContain('Arrival');
	expect(body).not.toContain('>Ends<');
});

test('SegmentEditForm uses transportation pick-up and drop-off labels', () => {
	const { body } = render(SegmentEditForm, { props: { segment: { ...segment, type: 'shuttle' }, tripId: 7, onCancel: () => {} } });
	expect(body).toContain('Pick-up');
	expect(body).toContain('Drop-off');
	expect(body).not.toContain('>Ends<');
});

const expectedMessages: Record<string, string> = {
	plan_title_label: 'Title',
	datetime_timezone_label: 'Timezone',
	hotel_checkout_timezone_label: 'Check-out timezone',
	flight_arrival_timezone_label: 'Arrival timezone',
	rental_car_dropoff_timezone_label: 'Drop-off timezone',
	datetime_end_timezone_label: 'End timezone',
	plan_country_label: 'Country',
	plan_country_placeholder: 'Select country',
	hotel_address_label: 'Address',
	plan_location_label: 'Venue',
	plan_meeting_point_label: 'Meeting / rally point',
	plan_rally_time_label: 'Rally time',
	common_cancel: 'Cancel',
	segment_new_save: 'Save',
	segment_edit_checkin_label: 'Check-in',
	segment_edit_departure_label: 'Departure',
	segment_edit_pickup_label: 'Pick-up',
	segment_edit_starts_label: 'Starts',
	segment_edit_checkout_label: 'Check-out',
	segment_edit_arrival_label: 'Arrival',
	segment_edit_dropoff_label: 'Drop-off',
	segment_edit_ends_label: 'Ends',
	segment_edit_confirmation_label: 'Confirmation #',
	segment_edit_payment_status_label: 'Payment status',
	segment_edit_payment_status_quoted: 'Quoted',
	segment_edit_payment_status_deposit_paid: 'Deposit paid',
	segment_edit_payment_status_fully_paid: 'Fully paid',
	segment_edit_payment_status_refunded: 'Refunded',
	segment_edit_payment_due_label: 'Payment due',
	segment_edit_attached_files_section: 'Attached files',
	segment_edit_attached_files_hint: 'PDFs or images (JPEG, PNG, WebP) such as QR codes and vouchers, max 10\u00a0MB each.',
	segment_edit_no_files: 'No files yet.',
	segment_edit_label_placeholder: 'Label (optional)',
	segment_edit_upload_file: 'Upload file',
	segment_edit_more_details_section: 'Additional details',
	segment_edit_stored_data_label: 'Stored data',
	segment_edit_stored_data_hint: 'Roamarr keeps booking-specific fields here. Usually no changes are needed.'
};

test('catalog messages match the English strings', () => {
	for (const [key, expected] of Object.entries(expectedMessages)) {
		const fn = (m as Record<string, (i?: unknown) => string>)[key];
		expect(typeof fn).toBe('function');
		expect(fn()).toBe(expected);
	}
});

test('SegmentEditForm source reads its strings from the catalog', () => {
	const source = readFileSync(new URL('./SegmentEditForm.svelte', import.meta.url), 'utf8');
	expect(source).toContain("from '$lib/paraglide/messages'");
	const used = [...new Set([...source.matchAll(/m\.([a-z0-9_]+)\(/g)].map(([, key]) => key))].sort();
	expect(used).toEqual([...Object.keys(expectedMessages)].sort());
	expect(source).not.toContain('Pick-up');
	expect(source).not.toContain('Drop-off');
	expect(source).not.toContain('Starts');
	expect(source).not.toContain('Ends');
	expect(source).not.toContain('Check-in');
	expect(source).not.toContain('Departure');
	expect(source).not.toContain('"Confirmation #"');
	expect(source).not.toContain('"Payment status"');
	expect(source).not.toContain('>Attached files<');
	expect(source).not.toContain('>Additional details<');
	expect(source).not.toContain('>Stored data<');
	expect(source).not.toContain('>Upload file<');
	expect(source).not.toContain('placeholder="Label (optional)"');
	expect(source).not.toContain('&nbsp;');
	expect(source).not.toContain('>Cancel</CancelButton>');
	expect(source).not.toContain('>Save</button>');
});

test('SegmentEditForm uses Starts and Ends labels for other segment types', () => {
	const { body } = render(SegmentEditForm, { props: { segment: { ...segment, type: 'note' }, tripId: 7, onCancel: () => {} } });
	expect(body).toContain('>Starts<');
	expect(body).toContain('>Ends<');
	expect(body).toContain('End timezone');
});

test('SegmentEditForm renders payment status options from the catalog', () => {
	const { body } = render(SegmentEditForm, {
		props: { segment: { ...segment, paymentStatus: 'deposit_paid' }, tripId: 7, onCancel: () => {} }
	});
	expect(body).toContain('>Quoted</option>');
	expect(body).toContain('>Deposit paid</option>');
	expect(body).toContain('>Fully paid</option>');
	expect(body).toContain('>Refunded</option>');
	expect(body).toMatch(/<option[^>]*value="deposit_paid"[^>]*>Deposit paid<\/option>/);
	expect(body).toMatch(/<label[^>]*>Payment status<\/label>/);
});

test('SegmentEditForm keeps the non-breaking space in the attached-files hint', () => {
	const { body } = render(SegmentEditForm, { props: { segment, tripId: 7, onCancel: () => {} } });
	expect(body.replaceAll('&nbsp;', '\u00a0')).toContain('max 10\u00a0MB each.');
	expect(body).toContain('placeholder="Label (optional)"');
	// Grid.js renders the empty state client-side only, so it is never in the SSR body.
	// Pin the wiring here; expectedMessages pins the text itself.
	const source = readFileSync(new URL('./SegmentEditForm.svelte', import.meta.url), 'utf8');
	expect(source).toContain('emptyMessage={m.segment_edit_no_files()}');
});

test('catalog declares the segment_edit hint with a real non-breaking space', () => {
	const raw = readFileSync(new URL('../../../../messages/en.json', import.meta.url), 'utf8');
	expect(raw).not.toContain('&nbsp;');
	const catalog = JSON.parse(raw);
	expect(catalog.segment_edit_attached_files_hint).toContain('\u00a0');
});
