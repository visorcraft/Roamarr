import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import { m } from '$lib/paraglide/messages';
import DirectionsForm from './DirectionsForm.svelte';
import MeetupForm from './MeetupForm.svelte';

const expectedDirectionsMessages: Record<string, string> = {
	directions_title_label: 'Directions title',
	directions_title_placeholder: 'Drive to hotel',
	directions_from_label: 'From',
	directions_from_placeholder: 'Starting point',
	directions_to_label: 'To',
	directions_to_placeholder: 'Destination',
	directions_notes_label: 'Notes',
	directions_notes_placeholder: 'Turn-by-turn notes'
};

const expectedMeetupMessages: Record<string, string> = {
	meetup_title_label: 'Meet up title',
	meetup_title_placeholder: 'Coffee with Alex',
	meetup_location_label: 'Meeting place',
	meetup_location_placeholder: 'Cafe address or landmark',
	meetup_attendees_label: 'Who',
	meetup_attendees_placeholder: 'Names or group'
};

test.each(Object.entries({ ...expectedDirectionsMessages, ...expectedMeetupMessages }))(
	'catalog message %s matches the English string',
	(key, expected) => {
		const fn = (m as Record<string, (i?: unknown) => string>)[key];
		expect(typeof fn).toBe('function');
		expect(fn()).toBe(expected);
	}
);

test('DirectionsForm renders its labels and placeholders from the catalog', () => {
	const { body } = render(DirectionsForm, { props: {} });
	expect(body).toMatch(/for="title">Directions title/);
	expect(body).toMatch(/for="detail_from">From/);
	expect(body).toMatch(/for="location">To/);
	expect(body).toMatch(/for="detail_notes">Notes/);
	expect(body).toContain('placeholder="Drive to hotel"');
	expect(body).toContain('placeholder="Starting point"');
	expect(body).toContain('placeholder="Destination"');
	expect(body).toContain('placeholder="Turn-by-turn notes"');
	for (const expected of Object.values(expectedDirectionsMessages)) {
		expect(body).toContain(expected);
	}
});

test('MeetupForm renders its labels and placeholders from the catalog', () => {
	const { body } = render(MeetupForm, { props: {} });
	expect(body).toMatch(/for="title">Meet up title/);
	expect(body).toMatch(/for="venue">Meeting place/);
	expect(body).toMatch(/for="detail_attendees">Who/);
	expect(body).toContain('placeholder="Coffee with Alex"');
	expect(body).toContain('placeholder="Cafe address or landmark"');
	expect(body).toContain('placeholder="Names or group"');
	for (const expected of Object.values(expectedMeetupMessages)) {
		expect(body).toContain(expected);
	}
});

test('DirectionsForm and MeetupForm keep their field contract', () => {
	const directions = render(DirectionsForm, { props: {} }).body;
	expect(directions).toMatch(/<input[^>]*name="title"[^>]*required/);
	for (const field of ['detail_from', 'location', 'detail_notes', 'startDate', 'startTime', 'startTz', 'endDate', 'endTime', 'endTz']) {
		expect(directions, `expected name="${field}"`).toContain(`name="${field}"`);
	}

	const meetup = render(MeetupForm, { props: {} }).body;
	expect(meetup).toMatch(/<input[^>]*name="title"[^>]*required/);
	expect(meetup).toContain('name="venue"');
	expect(meetup).toContain('name="detail_attendees"');

	const meetupSource = readFileSync(new URL('./MeetupForm.svelte', import.meta.url), 'utf8');
	expect(meetupSource).toContain('requireEnd={true}');
});

test('DirectionsForm and MeetupForm forward errors', () => {
	const directions = render(DirectionsForm, {
		props: { errors: { title: 'Required.', location: 'Pick a destination.' } }
	}).body;
	expect(directions).toContain('Required.');
	expect(directions).toContain('Pick a destination.');
	expect(directions).toContain('aria-invalid="true"');

	const meetup = render(MeetupForm, {
		props: { errors: { title: 'Need a title.' } }
	}).body;
	expect(meetup).toContain('Need a title.');
	expect(meetup).toContain('aria-invalid="true"');
});

test('DirectionsForm and MeetupForm read their strings from the catalog, not literals', () => {
	const directionsSource = readFileSync(new URL('./DirectionsForm.svelte', import.meta.url), 'utf8');
	const meetupSource = readFileSync(new URL('./MeetupForm.svelte', import.meta.url), 'utf8');
	for (const [source, table, prefix] of [
		[directionsSource, expectedDirectionsMessages, 'directions'],
		[meetupSource, expectedMeetupMessages, 'meetup']
	] as const) {
		expect(source).toContain("from '$lib/paraglide/messages'");
		const used = [...new Set([...source.matchAll(new RegExp(`m\\.(${prefix}_[a-z_]+)\\(\\)`, 'g'))].map(([, key]) => key))].sort();
		expect(used).toEqual(Object.keys(table).sort());
		expect(source).not.toMatch(/\b(?:titleLabel|titlePlaceholder|locationLabel|locationPlaceholder)="[^"]*"/);
		expect(source).not.toMatch(/\b(?:label|placeholder)="[^"]*"/);
	}
});
