import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import { m } from '$lib/paraglide/messages';
import ShuttleForm from './ShuttleForm.svelte';
import RideshareForm from './RideshareForm.svelte';

const expectedShuttleMessages: Record<string, string> = {
	shuttle_service_label: 'Shuttle service',
	shuttle_service_placeholder: 'Airport shuttle',
	shuttle_pickup_label: 'Pickup',
	shuttle_pickup_placeholder: 'Pickup location',
	shuttle_pickup_date_label: 'Pick-up date',
	shuttle_pickup_time_label: 'Pick-up time',
	shuttle_dropoff_date_label: 'Drop-off date',
	shuttle_dropoff_time_label: 'Drop-off time',
	shuttle_dropoff_timezone_label: 'Drop-off timezone',
	shuttle_dropoff_label: 'Drop-off',
	shuttle_dropoff_placeholder: 'Drop-off location'
};

const expectedRideshareMessages: Record<string, string> = {
	rideshare_service_label: 'Service',
	rideshare_service_placeholder: 'Uber / Lyft',
	rideshare_pickup_label: 'Pickup',
	rideshare_pickup_placeholder: 'Pickup address',
	rideshare_pickup_date_label: 'Pick-up date',
	rideshare_pickup_time_label: 'Pick-up time',
	rideshare_dropoff_date_label: 'Drop-off date',
	rideshare_dropoff_time_label: 'Drop-off time',
	rideshare_dropoff_timezone_label: 'Drop-off timezone',
	rideshare_dropoff_label: 'Drop-off',
	rideshare_dropoff_placeholder: 'Drop-off address'
};

test.each(Object.entries({ ...expectedShuttleMessages, ...expectedRideshareMessages }))(
	'catalog message %s matches the English string',
	(key, expected) => {
		const fn = (m as Record<string, (i?: unknown) => string>)[key];
		expect(typeof fn).toBe('function');
		expect(fn()).toBe(expected);
	}
);

test('ShuttleForm renders its labels and placeholders from the catalog', () => {
	const { body } = render(ShuttleForm, { props: {} });
	expect(body).toMatch(/for="title">Shuttle service(?:<!---->)?<\/label>/);
	expect(body).toContain('placeholder="Airport shuttle"');
	expect(body).toMatch(/for="venue">Pickup(?:<!---->)?<\/label>/);
	expect(body).toContain('placeholder="Pickup location"');
	expect(body).toMatch(/for="segment-startDate">Pick-up date(?:<!---->)?<\/label>/);
	expect(body).toMatch(/for="segment-startTime">Pick-up time(?:<!---->)?<\/label>/);
	expect(body).toMatch(/for="segment-endDate">Drop-off date(?:<!---->)?<\/label>/);
	expect(body).toMatch(/for="segment-endTime">Drop-off time(?:<!---->)?<\/label>/);
	expect(body).toMatch(/for="segment-endTz">Drop-off timezone(?:<!---->)?<\/label>/);
	expect(body).toMatch(/for="detail_dropoff">Drop-off(?:<!---->)?<\/label>/);
	expect(body).toContain('placeholder="Drop-off location"');
	for (const expected of Object.values(expectedShuttleMessages)) {
		expect(body).toContain(expected);
	}
});

test('RideshareForm renders its labels and placeholders from the catalog', () => {
	const { body } = render(RideshareForm, { props: {} });
	expect(body).toMatch(/for="title">Service(?:<!---->)?<\/label>/);
	expect(body).toContain('placeholder="Uber / Lyft"');
	expect(body).toMatch(/for="venue">Pickup(?:<!---->)?<\/label>/);
	expect(body).toContain('placeholder="Pickup address"');
	expect(body).toMatch(/for="segment-startDate">Pick-up date(?:<!---->)?<\/label>/);
	expect(body).toMatch(/for="segment-startTime">Pick-up time(?:<!---->)?<\/label>/);
	expect(body).toMatch(/for="segment-endDate">Drop-off date(?:<!---->)?<\/label>/);
	expect(body).toMatch(/for="segment-endTime">Drop-off time(?:<!---->)?<\/label>/);
	expect(body).toMatch(/for="segment-endTz">Drop-off timezone(?:<!---->)?<\/label>/);
	expect(body).toMatch(/for="detail_dropoff">Drop-off(?:<!---->)?<\/label>/);
	expect(body).toContain('placeholder="Drop-off address"');
	for (const expected of Object.values(expectedRideshareMessages)) {
		expect(body).toContain(expected);
	}
});

test('ShuttleForm and RideshareForm keep the required drop-off date and the drop-off field', () => {
	for (const Form of [ShuttleForm, RideshareForm]) {
		const { body } = render(Form, { props: {} });
		expect(body).toContain('name="detail_dropoff"');
		expect(body).toMatch(/<input[^>]*id="segment-endDate"[^>]*name="endDate"[^>]*required/);
		expect(body).toContain('name="venue"');
	}
});

test('ShuttleForm and RideshareForm forward errors', () => {
	for (const Form of [ShuttleForm, RideshareForm]) {
		const { body } = render(Form, { props: { errors: { title: 'Name the service.', endDate: 'Pick a drop-off date.' } } });
		expect(body).toContain('Name the service.');
		expect(body).toContain('Pick a drop-off date.');
	}
});

test('ShuttleForm and RideshareForm read their strings from the catalog, not literals', () => {
	const shuttleSource = readFileSync(new URL('./ShuttleForm.svelte', import.meta.url), 'utf8');
	const rideshareSource = readFileSync(new URL('./RideshareForm.svelte', import.meta.url), 'utf8');
	for (const [source, table, prefix] of [
		[shuttleSource, expectedShuttleMessages, 'shuttle'],
		[rideshareSource, expectedRideshareMessages, 'rideshare']
	] as const) {
		expect(source).toContain("from '$lib/paraglide/messages'");
		const used = [...new Set([...source.matchAll(new RegExp(`m\\.(${prefix}_[a-z_]+)\\(\\)`, 'g'))].map(([, key]) => key))].sort();
		expect(used).toEqual(Object.keys(table).sort());
	}
});

test('ShuttleForm and RideshareForm no longer hardcode their visible strings', () => {
	const shuttleSource = readFileSync(new URL('./ShuttleForm.svelte', import.meta.url), 'utf8');
	const rideshareSource = readFileSync(new URL('./RideshareForm.svelte', import.meta.url), 'utf8');
	for (const source of [shuttleSource, rideshareSource]) {
		expect(source).not.toMatch(/\b(?:title|location|startDate|startTime|endDate|endTime|endTimezone)(?:Label|Placeholder)="[^"]*"/);
		expect(source).not.toMatch(/\b(?:label|placeholder)="[^"]*"/);
	}
});
