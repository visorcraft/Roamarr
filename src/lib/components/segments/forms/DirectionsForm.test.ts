import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import DirectionsForm from './DirectionsForm.svelte';

// Safety net for the form-field consolidation: locks the submission-affecting
// contract (field names/ids/required/types) so a migration to shared field
// components cannot silently drop or rename a field.
test('DirectionsForm renders all expected fields with correct names', () => {
	const { body } = render(DirectionsForm, { props: {} });
	for (const field of ['title', 'detail_from', 'location', 'detail_notes', 'startDate', 'startTime', 'startTz', 'endDate', 'endTime', 'endTz']) {
		expect(body, `expected name="${field}"`).toContain(`name="${field}"`);
	}
	// title is required
	expect(body).toMatch(/<input[^>]*name="title"[^>]*required/);
});

test('DirectionsForm shows errors on invalid fields', () => {
	const { body } = render(DirectionsForm, {
		props: { errors: { title: 'Required.', location: 'Pick a destination.' } }
	});
	expect(body).toContain('Required.');
	expect(body).toContain('Pick a destination.');
	expect(body).toContain('input-error');
});
