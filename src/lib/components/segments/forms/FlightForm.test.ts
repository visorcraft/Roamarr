import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import FlightForm from './FlightForm.svelte';

// Safety net for form-field consolidation. Default-visible fields only (closed
// CollapseSections for manual/aircraft/passengers are not SSR by default).
test('FlightForm renders expected default-visible fields', () => {
	const { body } = render(FlightForm, { props: {} });
	for (const f of ['confirmationNumber', 'detail_totalCost', 'detail_booked', 'startDate', 'detail_airline', 'title', 'detail_seats', 'countryCode', 'cityName', 'venue', 'meetingPoint', 'meetingAt', 'detail_notes']) {
		expect(body, `expected name="${f}"`).toContain(`name="${f}"`);
	}
	expect(body).toMatch(/<input[^>]*name="startDate"[^>]*required/);
	expect(body).toMatch(/<select[^>]*name="countryCode"/);
});

test('FlightForm surfaces errors', () => {
	const { body } = render(FlightForm, {
		props: { errors: { confirmationNumber: 'Conf?', startDate: 'Bad date.', localStart: 'Bad time.', title: 'Number?', venue: 'Where?' } }
	});
	expect(body).toContain('Conf?');
	expect(body).toContain('Bad date.');
	expect(body).toContain('Bad time.');
	expect(body).toContain('Number?');
	expect(body).toContain('Where?');
});
