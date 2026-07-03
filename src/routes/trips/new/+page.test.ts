import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import Page from './+page.svelte';

// Safety net for form-field consolidation: locks field names/ids so the
// applyTemplate() JS (which looks up elements by id) and form submission keep
// working after migrating to shared field components.
test('New trip page renders all expected fields', () => {
	const { body } = render(Page, { props: { data: { tripTemplates: [] } } as any });
	for (const f of ['name', 'destinationCountryCode', 'destinationCityName', 'destinationCityLat', 'destinationCityLng', 'startDate', 'endDate', 'defaultVisibility', 'notes', 'tags']) {
		expect(body, `expected name="${f}"`).toContain(`name="${f}"`);
	}
	expect(body).toMatch(/<input[^>]*name="name"[^>]*required/);
});

test('New trip page shows validation errors', () => {
	const { body } = render(Page, {
		props: { data: { tripTemplates: [] }, form: { errors: { name: 'Name it.', startDate: 'Bad date.' } } } as any
	});
	expect(body).toContain('Name it.');
	expect(body).toContain('Bad date.');
});
