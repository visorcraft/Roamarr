import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import { m } from '$lib/paraglide/messages';
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

const expectedEventMessages: Record<string, string> = {
	event_name_label: 'Event name',
	event_name_placeholder: 'Enter event name',
	event_country_label: 'Country',
	event_country_placeholder: 'Select country',
	event_venue_label: 'Venue',
	event_venue_placeholder: 'Enter venue',
	event_phone_label: 'Phone',
	event_phone_placeholder: 'Enter phone',
	event_website_label: 'Website',
	event_website_placeholder: 'Enter website',
	event_email_label: 'Email',
	event_email_placeholder: 'Enter email',
	event_notes_label: 'Notes',
	event_notes_placeholder: "Enter note e.g. Don't forget your charger!",
	event_more_details_section: 'More details',
	event_category_label: 'Category',
	event_category_placeholder: 'Concert, conference, etc.',
	event_dress_code_label: 'Dress code',
	event_dress_code_placeholder: 'Optional dress code',
	event_attendees_section: 'Attendees',
	event_attendees_label: 'Attendees',
	event_attendees_placeholder: 'Who is attending?',
	event_booking_section: 'Booking info',
	event_booking_site_label: 'Booking site',
	event_booking_site_placeholder: 'Enter booking site',
	event_booking_reference_label: 'Booking reference',
	event_booking_reference_placeholder: 'Enter booking reference',
	event_booking_website_label: 'Booking website',
	event_booking_website_placeholder: 'Enter booking website',
	event_booking_phone_label: 'Booking phone',
	event_booking_phone_placeholder: 'Enter booking phone',
	event_booking_date_label: 'Booking date',
	event_booking_rate_label: 'Booking rate',
	event_booking_rate_placeholder: 'Enter booking rate',
	event_total_cost_label: 'Total cost',
	event_total_cost_placeholder: 'Enter total cost',
	event_restrictions_label: 'Restrictions',
	event_restrictions_placeholder: 'Enter restrictions'
};

test.each(Object.entries(expectedEventMessages))('catalog message %s matches the English string', (key, expected) => {
	const fn = (m as Record<string, (i?: unknown) => string>)[key];
	expect(typeof fn).toBe('function');
	expect(fn()).toBe(expected);
});

test('EventForm renders labels from the catalog', () => {
	const { body } = render(EventForm, { props: {} });
	for (const expected of [
		'Event name',
		'Enter event name',
		'Country',
		'Select country',
		'Venue',
		'Enter venue',
		'Phone',
		'Enter phone',
		'Website',
		'Enter website',
		'Email',
		'Enter email',
		'Notes',
		'More details',
		'Attendees',
		'Booking info',
		'Booking site',
		'Enter booking site',
		'Booking reference',
		'Enter booking reference',
		'Booking website',
		'Enter booking website',
		'Booking phone',
		'Enter booking phone',
		'Booking date',
		'Booking rate',
		'Enter booking rate',
		'Total cost',
		'Enter total cost',
		'Restrictions',
		'Enter restrictions'
	]) {
		expect(body).toContain(expected);
	}
	// The notes placeholder contains an apostrophe, which SSR escapes in the attribute.
	expect(body).toContain('placeholder="Enter note e.g. Don');
});

test('EventForm keeps a caller-supplied venue label', () => {
	const { body } = render(EventForm, { props: { venueLabel: 'Meeting place' } });
	expect(body).toContain('Meeting place');
});
