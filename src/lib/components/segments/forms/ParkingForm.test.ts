import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import { m } from '$lib/paraglide/messages';
import ParkingForm from './ParkingForm.svelte';

const expectedParkingMessages: Record<string, string> = {
	parking_location_label: 'Parking location',
	parking_location_placeholder: 'DFW Airport parking',
	parking_lot_label: 'Lot / garage',
	parking_lot_placeholder: 'Terminal garage, level 3',
	parking_confirmation_label: 'Confirmation',
	parking_confirmation_placeholder: 'Enter confirmation',
	parking_total_cost_label: 'Total cost',
	parking_total_cost_placeholder: 'Enter total cost',
	parking_notes_label: 'Notes',
	parking_notes_placeholder: 'Optional notes'
};

test.each(Object.entries(expectedParkingMessages))('catalog message %s matches the English string', (key, expected) => {
	const fn = (m as Record<string, (i?: unknown) => string>)[key];
	expect(typeof fn).toBe('function');
	expect(fn()).toBe(expected);
});

// Safety net for form-field consolidation.
test('ParkingForm renders all expected fields', () => {
	const { body } = render(ParkingForm, { props: {} });
	for (const f of ['title', 'startDate', 'startTime', 'endDate', 'endTime', 'startTz', 'location', 'confirmationNumber', 'detail_totalCost', 'detail_notes', 'detail_booked']) {
		expect(body, `expected name="${f}"`).toContain(`name="${f}"`);
	}
	expect(body).toMatch(/<input[^>]*name="title"[^>]*required/);
	expect(body).toMatch(/<input[^>]*name="startDate"[^>]*required/);
	expect(body).toMatch(/<input[^>]*name="endDate"[^>]*required/);
});

test('ParkingForm surfaces composite errors', () => {
	const { body } = render(ParkingForm, {
		props: { errors: { title: 'Where?', localStart: 'Bad start.', endAt: 'Bad end.' } }
	});
	expect(body).toContain('Where?');
	expect(body).toContain('Bad start.');
	expect(body).toContain('Bad end.');
});

test('ParkingForm renders its labels and placeholders from the catalog', () => {
	const { body } = render(ParkingForm, { props: {} });
	for (const expected of Object.values(expectedParkingMessages)) {
		expect(body).toContain(expected);
	}
	expect(body).toContain('placeholder="DFW Airport parking"');
	expect(body).toContain('placeholder="Terminal garage, level 3"');
	expect(body).toContain('Start date');
	expect(body).toContain('Start time');
	expect(body).toContain('End date');
	expect(body).toContain('End time');
	expect(body).toMatch(/for="startTz">Timezone<\/label>/);
});

test('ParkingForm reads its labels from the catalog, not literals', () => {
	const source = readFileSync(new URL('./ParkingForm.svelte', import.meta.url), 'utf8');
	expect(source).toContain("from '$lib/paraglide/messages'");
	const used = [...new Set([...source.matchAll(/m\.(parking_[a-z_]+)\(\)/g)].map(([, key]) => key))].sort();
	expect(used).toEqual(Object.keys(expectedParkingMessages).sort());
	expect(source).toContain('m.datetime_start_date_label()');
	expect(source).toContain('m.datetime_start_time_label()');
	expect(source).toContain('m.datetime_end_date_label()');
	expect(source).toContain('m.datetime_end_time_label()');
	expect(source).toContain('m.datetime_timezone_label()');
	expect(source).not.toContain('label="Parking location"');
	expect(source).not.toContain('label="Start date"');
	expect(source).not.toContain('label="Start time"');
	expect(source).not.toContain('label="End date"');
	expect(source).not.toContain('label="End time"');
	expect(source).not.toContain('>Timezone</label>');
	expect(source).not.toContain('label="Lot / garage"');
	expect(source).not.toContain('label="Confirmation"');
	expect(source).not.toContain('label="Total cost"');
	expect(source).not.toContain('label="Notes"');
	expect(source).not.toContain('placeholder="Optional notes"');
});
