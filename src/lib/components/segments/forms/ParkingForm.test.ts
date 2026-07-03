import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import ParkingForm from './ParkingForm.svelte';

// Safety net for form-field consolidation.
test('ParkingForm renders all expected fields', () => {
	const { body } = render(ParkingForm, { props: {} });
	for (const f of ['title', 'startDate', 'startTime', 'endDate', 'endTime', 'startTz', 'location', 'confirmationNumber', 'detail_totalCost', 'detail_notes', 'detail_booked']) {
		expect(body, `expected name="${f}"`).toContain(`name="${f}"`);
	}
	expect(body).toMatch(/<input[^>]*name="title"[^>]*required/);
	expect(body).toMatch(/<input[^>]*name="startDate"[^>]*required/);
	expect(body).toMatch(/<input[^>]*name="endDate"[^>]*required/);
});

test('ParkingForm surfaces composite errors', () => {
	const { body } = render(ParkingForm, {
		props: { errors: { title: 'Where?', localStart: 'Bad start.', endAt: 'Bad end.' } }
	});
	expect(body).toContain('Where?');
	expect(body).toContain('Bad start.');
	expect(body).toContain('Bad end.');
});
