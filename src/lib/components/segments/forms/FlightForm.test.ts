import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import { m } from '$lib/paraglide/messages';
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

test('FlightForm seeds city coordinates from lat/lng props', () => {
	const { body } = render(FlightForm, {
		props: {
			cityLat: 37.57,
			cityLng: 126.98
		}
	});
	// Without trip context, city name starts empty; coords still seed for re-save.
	expect(body).toContain('value="37.57"');
	expect(body).toContain('value="126.98"');
	expect(body).toContain('name="cityLat"');
	expect(body).toContain('name="cityLng"');
});

const expectedFlightMessages: Record<string, string> = {
	flight_confirmation_label: 'Confirmation',
	flight_confirmation_placeholder: 'Enter confirmation',
	flight_total_cost_label: 'Total cost',
	flight_total_cost_placeholder: 'Enter total cost',
	flight_departure_date_label: 'Departure date',
	flight_airline_label: 'Airline',
	flight_airline_placeholder: 'Enter airline',
	flight_number_label: 'Flight number',
	flight_number_placeholder: 'Enter flight number',
	flight_seats_label: 'Seats',
	flight_seats_placeholder: 'Enter seats',
	flight_country_label: 'Country',
	flight_country_placeholder: 'Select country',
	flight_venue_label: 'Venue',
	flight_venue_placeholder: 'Airport or terminal',
	flight_manual_section: 'Manually edit flight',
	flight_departure_airport_label: 'Departure airport',
	flight_departure_airport_placeholder: 'JFK',
	flight_arrival_airport_label: 'Arrival airport',
	flight_arrival_airport_placeholder: 'LHR',
	flight_departure_time_label: 'Departure time',
	flight_arrival_date_label: 'Arrival date',
	flight_arrival_time_label: 'Arrival time',
	flight_timezone_label: 'Timezone',
	flight_arrival_timezone_label: 'Arrival timezone',
	flight_route_label: 'Route label',
	flight_route_placeholder: 'JFK \u2192 LHR',
	flight_aircraft_section: 'Aircraft and service info',
	flight_aircraft_label: 'Aircraft',
	flight_aircraft_placeholder: 'Boeing 787',
	flight_cabin_label: 'Cabin / class',
	flight_cabin_placeholder: 'Economy, business, etc.',
	flight_frequent_flyer_label: 'Frequent flyer #',
	flight_frequent_flyer_placeholder: 'Optional loyalty number',
	flight_meeting_point_label: 'Meeting / rally point',
	flight_meeting_point_placeholder: 'e.g. Hotel lobby, gate A12',
	flight_rally_time_label: 'Rally time',
	flight_add_button: 'Add a flight',
	flight_notes_label: 'Notes',
	flight_notes_placeholder: "Enter note e.g. Don't forget your charger!",
	flight_more_details_section: 'More details',
	flight_expand_all: 'Expand all',
	flight_passengers_section: 'Passengers',
	flight_passengers_label: 'Passengers',
	flight_passengers_placeholder: 'Passenger names'
};

test.each(Object.entries(expectedFlightMessages))('catalog message %s matches the English string', (key, expected) => {
	const fn = (m as Record<string, (inputs?: unknown) => string>)[key];
	expect(typeof fn).toBe('function');
	expect(fn()).toBe(expected);
});

test('flight_section_title interpolates the flight number', () => {
	expect(m.flight_section_title({ number: 1 })).toBe('Flight 1');
	expect(m.flight_section_title({ number: 2 })).toBe('Flight 2');
});

test('FlightForm renders the default-visible strings from the catalog', () => {
	const { body } = render(FlightForm, { props: {} });
	for (const expected of [
		m.flight_confirmation_label(),
		m.flight_confirmation_placeholder(),
		m.flight_total_cost_label(),
		m.flight_section_title({ number: 1 }),
		m.flight_departure_date_label(),
		m.flight_airline_label(),
		m.flight_number_label(),
		m.flight_seats_label(),
		m.flight_country_label(),
		m.flight_country_placeholder(),
		m.flight_venue_label(),
		m.flight_venue_placeholder(),
		m.flight_meeting_point_label(),
		m.flight_meeting_point_placeholder(),
		m.flight_rally_time_label(),
		m.flight_add_button(),
		m.flight_notes_label(),
		m.flight_more_details_section(),
		m.flight_expand_all()
	]) {
		expect(body).toContain(expected);
	}
	// The notes placeholder contains an apostrophe, which SSR emits as &#39;.
	expect(body).toMatch(/Enter note e\.g\. Don(?:&#39;|')t forget your charger!/);
});

test('FlightForm source uses the catalog and keeps no hardcoded UI strings', () => {
	const source = readFileSync(new URL('./FlightForm.svelte', import.meta.url), 'utf8');
	expect(source).toContain("from '$lib/paraglide/messages'");
	expect(source).not.toMatch(/\b(?:label|placeholder|title)="/);
});
