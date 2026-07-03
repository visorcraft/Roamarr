import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import RentalCarForm from './RentalCarForm.svelte';

// Safety net for form-field consolidation (default-visible fields only; closed
// CollapseSections and the sameAsPickup=false branch are not SSR by default).
test('RentalCarForm renders expected default-visible fields', () => {
	const { body } = render(RentalCarForm, { props: {} });
	const fields = [
		'title', 'startDate', 'startTime', 'startTz', 'endDate', 'endTime', 'endTz',
		'detail_website', 'detail_email', 'confirmationNumber', 'detail_totalCost', 'detail_booked',
		'detail_pickupLocation', 'location', 'detail_phone', 'detail_sameAsPickup',
		'detail_carType', 'detail_mileageCharges', 'detail_carDetails',
		'meetingPoint', 'meetingAt', 'detail_notes'
	];
	for (const f of fields) {
		expect(body, `expected name="${f}"`).toContain(`name="${f}"`);
	}
});

test('RentalCarForm surfaces errors', () => {
	const { body } = render(RentalCarForm, {
		props: { errors: { title: 'Agency?', location: 'Address?', meetingPoint: 'Where?' } }
	});
	expect(body).toContain('Agency?');
	expect(body).toContain('Address?');
	expect(body).toContain('Where?');
});
