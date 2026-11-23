import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import { m } from '$lib/paraglide/messages';
import HotelForm from './HotelForm.svelte';

const expectedHotelMessages: Record<string, string> = {
	hotel_name_label: 'Hotel name',
	hotel_name_placeholder: 'Grand Hotel',
	hotel_address_label: 'Address',
	hotel_address_placeholder: 'Enter address',
	hotel_checkin_date_label: 'Check-in date',
	hotel_checkin_time_label: 'Check-in time',
	hotel_checkout_date_label: 'Check-out date',
	hotel_checkout_time_label: 'Check-out time',
	hotel_checkout_timezone_label: 'Check-out timezone',
	hotel_phone_label: 'Phone',
	hotel_phone_placeholder: 'Hotel phone'
};

test.each(Object.entries(expectedHotelMessages))('catalog message %s matches the English string', (key, expected) => {
	const fn = (m as Record<string, (i?: unknown) => string>)[key];
	expect(typeof fn).toBe('function');
	expect(fn()).toBe(expected);
});

test('HotelForm renders labels from the catalog', () => {
	const { body } = render(HotelForm, { props: {} });
	for (const expected of Object.values(expectedHotelMessages)) {
		expect(body).toContain(expected);
	}
	expect(body).toContain('placeholder="Hotel phone"');
});

test('HotelForm keeps the phone field and forwards errors', () => {
	const { body } = render(HotelForm, { props: { errors: { title: 'Name the hotel.' } } });
	expect(body).toContain('name="detail_phone"');
	expect(body).toMatch(/<input[^>]*type="tel"/);
	expect(body).toContain('Name the hotel.');
});

test('HotelForm reads its labels from the catalog, not literals', () => {
	const source = readFileSync(new URL('./HotelForm.svelte', import.meta.url), 'utf8');
	expect(source).toContain("from '$lib/paraglide/messages'");
	const used = [...new Set([...source.matchAll(/m\.(hotel_[a-z_]+)\(\)/g)].map(([, key]) => key))].sort();
	expect(used).toEqual(Object.keys(expectedHotelMessages).sort());
	expect(source).not.toContain('titleLabel="Hotel name"');
	expect(source).not.toContain('label="Phone"');
});
