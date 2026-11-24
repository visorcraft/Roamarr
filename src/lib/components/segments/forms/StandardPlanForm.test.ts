import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import { m } from '$lib/paraglide/messages';
import DateTimeRangeFields from '../DateTimeRangeFields.svelte';
import StandardPlanForm from './StandardPlanForm.svelte';
import BoatForm from './BoatForm.svelte';
import HotelForm from './HotelForm.svelte';
import FoodForm from './FoodForm.svelte';
import TrainForm from './TrainForm.svelte';
import ShuttleForm from './ShuttleForm.svelte';
import RideshareForm from './RideshareForm.svelte';

// Safety net for form-field consolidation: locks submission-affecting field
// names so a migration to shared components cannot silently drop/rename one.
test('StandardPlanForm renders all base fields', () => {
	const { body } = render(StandardPlanForm, { props: {} });
	for (const f of ['title', 'countryCode', 'cityName', 'cityLat', 'cityLng', 'venue', 'meetingPoint', 'meetingAt', 'detail_notes', 'detail_booked']) {
		expect(body, `expected name="${f}"`).toContain(`name="${f}"`);
	}
	expect(body).toMatch(/<input[^>]*name="title"[^>]*required/);
	expect(body).toMatch(/<select[^>]*name="countryCode"/);
});

test('StandardPlanForm shows field errors', () => {
	const { body } = render(StandardPlanForm, { props: { errors: { title: 'Need a title.', venue: 'Where?' } } });
	expect(body).toContain('Need a title.');
	expect(body).toContain('Where?');
});

test('StandardPlanForm seeds city name and coordinates into the autocomplete', () => {
	const { body } = render(StandardPlanForm, {
		props: {
			countryCode: 'TH',
			cityName: 'Bangkok',
			cityLat: 13.75,
			cityLng: 100.5
		}
	});
	expect(body).toContain('value="Bangkok"');
	expect(body).toContain('value="13.75"');
	expect(body).toContain('value="100.5"');
	expect(body).toMatch(/<option[^>]*value="TH"[^>]*selected/);
});

test('delegate forms add their extra fields on top of StandardPlanForm', () => {
	const hotel = render(HotelForm, { props: {} }).body;
	expect(hotel).toContain('name="detail_phone"');
	expect(hotel).toContain('Check-out time');
	expect(render(FoodForm, { props: {} }).body).toContain('name="detail_partySize"');
	expect(render(TrainForm, { props: {} }).body).toContain('name="detail_seat"');
	// BoatForm is a pure wrapper (labels only) and still surfaces the base fields
	expect(render(BoatForm, { props: {} }).body).toContain('name="title"');
	expect(render(ShuttleForm, { props: {} }).body).toContain('Pick-up time');
	expect(render(RideshareForm, { props: {} }).body).toContain('Drop-off time');
});

const expectedDateTimeMessages: Record<string, string> = {
	datetime_start_date_label: 'Start date',
	datetime_start_time_label: 'Start time',
	datetime_timezone_label: 'Timezone',
	datetime_end_date_label: 'End date',
	datetime_end_time_label: 'End time',
	datetime_end_timezone_label: 'End timezone'
};

const expectedPlanMessages: Record<string, string> = {
	plan_title_label: 'Title',
	plan_title_placeholder: 'Enter title',
	plan_location_label: 'Venue',
	plan_location_placeholder: 'Enter venue',
	plan_country_label: 'Country',
	plan_country_placeholder: 'Select country',
	plan_meeting_point_label: 'Meeting / rally point',
	plan_meeting_point_placeholder: 'e.g. Hotel lobby, gate A12',
	plan_rally_time_label: 'Rally time',
	plan_notes_label: 'Notes',
	plan_notes_placeholder: 'Optional notes',
	plan_notes_hint: 'Markdown supported'
};

test.each([...Object.entries(expectedDateTimeMessages), ...Object.entries(expectedPlanMessages)])(
	'catalog message %s matches the English string',
	(key, expected) => {
		const fn = (m as Record<string, (i?: unknown) => string>)[key];
		expect(typeof fn).toBe('function');
		expect(fn()).toBe(expected);
	}
);

test('DateTimeRangeFields renders its default labels from the catalog', () => {
	const { body } = render(DateTimeRangeFields, { props: {} });
	for (const expected of Object.values(expectedDateTimeMessages)) {
		expect(body).toContain(expected);
	}
	expect(body).toContain('id="segment-startDate"');
	expect(body).toContain('id="segment-startTz"');
	expect(body).toContain('id="segment-endDate"');
	expect(body).toContain('id="segment-endTz"');

	const event = render(DateTimeRangeFields, { props: { idPrefix: 'event' } }).body;
	for (const expected of Object.values(expectedDateTimeMessages)) {
		expect(event).toContain(expected);
	}
	expect(event).toContain('id="event-startDate"');
	expect(event).toContain('id="event-endTz"');
});

test('DateTimeRangeFields keeps caller-provided labels', () => {
	const { body } = render(DateTimeRangeFields, {
		props: {
			startDateLabel: 'Check-in date',
			startTimeLabel: 'Check-in time',
			endDateLabel: 'Check-out date',
			endTimeLabel: 'Check-out time',
			endTimezoneLabel: 'Check-out timezone'
		}
	});
	expect(body).toContain('Check-in date');
	expect(body).toContain('Check-in time');
	expect(body).toContain('Check-out date');
	expect(body).toContain('Check-out time');
	expect(body).toContain('Check-out timezone');
	expect(body).toContain('Timezone');
	expect(body).not.toContain('Start date');
});

test('StandardPlanForm renders its default labels from the catalog', () => {
	const { body } = render(StandardPlanForm, { props: {} });
	for (const expected of Object.values(expectedPlanMessages)) {
		expect(body).toContain(expected);
	}
	for (const expected of ['Start date', 'Start time', 'End date', 'End time', 'End timezone']) {
		expect(body).toContain(expected);
	}
	expect(body).toContain('placeholder="e.g. Hotel lobby, gate A12"');
	expect(body).toContain('placeholder="Optional notes"');

	const custom = render(StandardPlanForm, {
		props: { titleLabel: 'Cabin name', titlePlaceholder: 'Enter cabin name' }
	}).body;
	expect(custom).toContain('Cabin name');
	expect(custom).toContain('placeholder="Enter cabin name"');
	expect(custom).not.toContain('placeholder="Enter title"');
});

test('StandardPlanForm and DateTimeRangeFields read labels from the catalog, not literals', () => {
	const planSource = readFileSync(new URL('./StandardPlanForm.svelte', import.meta.url), 'utf8');
	const dtSource = readFileSync(new URL('../DateTimeRangeFields.svelte', import.meta.url), 'utf8');
	expect(planSource).toContain("from '$lib/paraglide/messages'");
	expect(dtSource).toContain("from '$lib/paraglide/messages'");

	const planUsed = [...new Set([...planSource.matchAll(/m\.((?:plan_|datetime_)[a-z_]+)\(\)/g)].map(([, key]) => key))].sort();
	expect(planUsed).toEqual([
		...Object.keys(expectedPlanMessages),
		'datetime_end_date_label',
		'datetime_end_time_label',
		'datetime_end_timezone_label',
		'datetime_start_date_label',
		'datetime_start_time_label'
	].sort());

	const dtUsed = [...new Set([...dtSource.matchAll(/m\.((?:plan_|datetime_)[a-z_]+)\(\)/g)].map(([, key]) => key))].sort();
	expect(dtUsed).toEqual(Object.keys(expectedDateTimeMessages).sort());

	for (const source of [planSource, dtSource]) {
		expect(source).not.toContain("= 'Start date'");
		expect(source).not.toContain("= 'End timezone'");
		expect(source).not.toContain('>Country</label>');
		expect(source).not.toContain('label="Rally time"');
		expect(source).not.toContain('hint="Markdown supported"');
		expect(source).not.toContain('>Timezone</label>');
	}
});
