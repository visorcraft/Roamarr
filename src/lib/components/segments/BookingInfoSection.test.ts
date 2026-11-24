import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import { m } from '$lib/paraglide/messages';
import BookingInfoSection from './BookingInfoSection.svelte';

const expectedBookingMessages: Record<string, string> = {
	booking_section: 'Booking info',
	booking_site_label: 'Booking site',
	booking_site_placeholder: 'Enter booking site',
	booking_reference_label: 'Booking reference',
	booking_reference_placeholder: 'Enter booking reference',
	booking_website_label: 'Booking website',
	booking_website_placeholder: 'Enter booking website',
	booking_phone_label: 'Booking phone',
	booking_phone_placeholder: 'Enter booking phone',
	booking_date_label: 'Booking date',
	booking_rate_label: 'Booking rate',
	booking_rate_placeholder: 'Enter booking rate',
	booking_restrictions_label: 'Restrictions',
	booking_restrictions_placeholder: 'Enter restrictions'
};

const fieldIds = [
	'booking_site',
	'booking_reference',
	'booking_website',
	'booking_phone',
	'booking_date',
	'booking_rate',
	'booking_restrictions'
];

test.each(Object.entries(expectedBookingMessages))('catalog message %s matches the English string', (key, expected) => {
	const fn = (m as Record<string, (i?: unknown) => string>)[key];
	expect(typeof fn).toBe('function');
	expect(fn()).toBe(expected);
});

test('BookingInfoSection renders its text from the catalog', () => {
	const { body } = render(BookingInfoSection, { props: { open: true } });
	for (const expected of Object.values(expectedBookingMessages)) {
		expect(body).toContain(expected);
	}
	for (const [key, value] of Object.entries(expectedBookingMessages)) {
		if (key.endsWith('_placeholder')) {
			expect(body).toContain(`placeholder="${value}"`);
		}
	}
});

test('BookingInfoSection keeps every field name, type, and label association', () => {
	const { body } = render(BookingInfoSection, { props: { open: true } });
	for (const id of fieldIds) {
		expect(body).toContain(`name="${id}"`);
		expect(body).toMatch(new RegExp(`<label[^>]*for="${id}"`));
		expect(body).toMatch(new RegExp(`<(input|textarea)[^>]*id="${id}"`));
	}
	expect(body).toMatch(/<input[^>]*type="date"/);
	expect(body).toMatch(/<textarea[^>]*rows="3"/);
});

test('BookingInfoSection reads its text from the catalog, not literals', () => {
	const source = readFileSync(new URL('./BookingInfoSection.svelte', import.meta.url), 'utf8');
	expect(source).toContain("from '$lib/paraglide/messages'");
	const used = [...new Set([...source.matchAll(/m\.(booking_[a-z_]+)\(\)/g)].map(([, key]) => key))].sort();
	expect(used).toEqual(Object.keys(expectedBookingMessages).sort());
	const remainder = source.replace(/\{[^}]*\}/g, '');
	expect(remainder).not.toMatch(/<(label|summary)[^>]*>[^<]*[A-Za-z][^<]*<\/\1>/);
	expect(remainder).not.toMatch(/\b(placeholder|title|aria-label)="[^"]*[A-Za-z][^"]*"/);
});
