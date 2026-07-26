import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import EventForm from './EventForm.svelte';

// Safety net for form-field consolidation.
test('EventForm renders all expected fields', () => {
	const { body } = render(EventForm, { props: {} });
	const fields = [
		'title', 'countryCode', 'cityName', 'venue', 'detail_phone', 'detail_website', 'detail_email',
		'detail_notes',
		'booking_site', 'booking_reference', 'booking_website', 'booking_phone',
		'booking_date', 'booking_rate', 'booking_totalCost', 'booking_restrictions', 'detail_booked'
	];
	for (const f of fields) {
		expect(body, `expected name="${f}"`).toContain(`name="${f}"`);
	}
	expect(body).toMatch(/<input[^>]*name="title"[^>]*required/);
	expect(body).toMatch(/<select[^>]*name="countryCode"/);
});

test('EventForm shows errors on title and venue', () => {
	const { body } = render(EventForm, { props: { errors: { title: 'Name it.', venue: 'Where?' } } });
	expect(body).toContain('Name it.');
	expect(body).toContain('Where?');
});

test('EventForm seeds city coordinates from props', () => {
	const { body } = render(EventForm, {
		props: { countryCode: 'TH', cityName: 'Bangkok', cityLat: 13.75, cityLng: 100.5 }
	});
	expect(body).toContain('value="Bangkok"');
	expect(body).toContain('value="13.75"');
	expect(body).toContain('value="100.5"');
});
