import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import CityAutocomplete from './CityAutocomplete.svelte';

const props = {
	countryCode: 'US',
	name: 'city',
	value: '',
	latName: 'lat',
	lngName: 'lng'
};

test('exposes the ARIA 1.2 combobox contract on the input', () => {
	const { body } = render(CityAutocomplete, { props });
	// input is a combobox that controls a list, auto-complete list semantics
	expect(body).toContain('role="combobox"');
	expect(body).toContain('aria-autocomplete="list"');
	expect(body).toContain('aria-expanded="false"');
	expect(body).toContain('aria-controls="city-listbox"');
});

test('associates the visible label with the input', () => {
	const { body } = render(CityAutocomplete, { props });
	expect(body).toMatch(/<label[^>]*for="city">/);
	expect(body).toContain('id="city"');
});

test('does not render the listbox when closed', () => {
	const { body } = render(CityAutocomplete, { props });
	expect(body).not.toContain('role="listbox"');
});

test('wires field error via id and keeps hidden lat/lng inputs', () => {
	const { body } = render(CityAutocomplete, {
		props: { ...props, errors: { city: 'City is required.' } }
	});
	expect(body).toContain('id="city-error"');
	expect(body).toContain('City is required.');
	expect(body).toContain('name="lat"');
	expect(body).toContain('name="lng"');
});
