import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import Page from './+page.svelte';

const trip = {
	id: 1, name: 'Lisbon', destinationCountryCode: 'PT', destinationAdmin1Code: null, destinationCityName: 'Lisbon',
	destinationCityLat: 38.7, destinationCityLng: -9.1, startDate: '2026-08-01', endDate: '2026-08-10',
	notes: 'beach', tags: '["summer"]', status: 'planning', baseCurrency: 'USD'
};

// Safety net for form-field consolidation.
test('Edit trip page renders all expected fields with values', () => {
	const { body } = render(Page, { props: { data: { trip, owner: true } } as any });
	for (const f of ['name', 'destinationCountryCode', 'destinationCityName', 'destinationCityLat', 'destinationCityLng', 'startDate', 'endDate', 'status', 'notes', 'tags', 'baseCurrency']) {
		expect(body, `expected name="${f}"`).toContain(`name="${f}"`);
	}
	expect(body).toContain('value="Lisbon"');
	// Notes must use the value prop (children are ignored by TextAreaField).
	expect(body).toContain('>beach</textarea>');
	// Existing city coords are seeded into hidden inputs for re-save.
	expect(body).toContain('value="38.7"');
	expect(body).toContain('value="-9.1"');
});

test('Edit trip page shows validation errors', () => {
	const { body } = render(Page, {
		props: { data: { trip, owner: true }, form: { errors: { name: 'Name?', baseCurrency: '3 letters only.' } } } as any
	});
	expect(body).toContain('Name?');
	expect(body).toContain('3 letters only.');
});
