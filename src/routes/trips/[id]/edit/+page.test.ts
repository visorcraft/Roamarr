import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import Page from './+page.svelte';

const trip = {
	id: 1, name: 'Lisbon', destinationCountryCode: 'PT', destinationCityName: 'Lisbon',
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
});

test('Edit trip page shows validation errors', () => {
	const { body } = render(Page, {
		props: { data: { trip, owner: true }, form: { errors: { name: 'Name?', baseCurrency: '3 letters only.' } } } as any
	});
	expect(body).toContain('Name?');
	expect(body).toContain('3 letters only.');
});
