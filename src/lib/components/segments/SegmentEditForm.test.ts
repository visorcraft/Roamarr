import { render } from 'svelte/server';
import { test, expect } from 'vitest';
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
