import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import { m } from '$lib/paraglide/messages';
import PoiForm from './PoiForm.svelte';
import BoatForm from './BoatForm.svelte';
import type { PlacePrefill } from '$lib/server/segmentNewPage';

const expectedPoiMessages: Record<string, string> = {
	poi_title_label: 'Place name',
	poi_title_placeholder: 'Eiffel Tower',
	poi_location_label: 'Address',
	poi_location_placeholder: 'Enter address'
};

const expectedBoatMessages: Record<string, string> = {
	boat_title_label: 'Cruise / ferry name',
	boat_title_placeholder: 'Harbor ferry',
	boat_location_label: 'Port / pier',
	boat_location_placeholder: 'Pier 33'
};

test.each(Object.entries({ ...expectedPoiMessages, ...expectedBoatMessages }))(
	'catalog message %s matches the English string',
	(key, expected) => {
		const fn = (m as Record<string, (i?: unknown) => string>)[key];
		expect(typeof fn).toBe('function');
		expect(fn()).toBe(expected);
	}
);

test('PoiForm renders its labels and placeholders from the catalog', () => {
	const { body } = render(PoiForm, { props: {} });
	expect(body).toMatch(/for="title">Place name(?:<!---->)?<\/label>/);
	expect(body).toContain('placeholder="Eiffel Tower"');
	expect(body).toMatch(/for="venue">Address(?:<!---->)?<\/label>/);
	expect(body).toContain('placeholder="Enter address"');
	for (const expected of Object.values(expectedPoiMessages)) {
		expect(body).toContain(expected);
	}
	expect(body).not.toContain('detail_place_id');
});

test('BoatForm renders its labels and placeholders from the catalog', () => {
	const { body } = render(BoatForm, { props: {} });
	expect(body).toMatch(/for="title">Cruise \/ ferry name(?:<!---->)?<\/label>/);
	expect(body).toContain('placeholder="Harbor ferry"');
	expect(body).toMatch(/for="venue">Port \/ pier(?:<!---->)?<\/label>/);
	expect(body).toContain('placeholder="Pier 33"');
	for (const expected of Object.values(expectedBoatMessages)) {
		expect(body).toContain(expected);
	}
	expect(body).toMatch(/<input[^>]*id="segment-endDate"[^>]*name="endDate"[^>]*required/);
});

test('PoiForm still prefills a saved place', () => {
	const prefill: PlacePrefill = {
		placeId: 123,
		title: 'Eiffel Tower',
		venue: 'Champ de Mars',
		countryCode: 'FR',
		admin1Code: 'IDF',
		cityName: 'Paris',
		cityLat: 48.8584,
		cityLng: 2.2945
	};
	const { body } = render(PoiForm, { props: { prefill } });
	expect(body).toContain('name="detail_place_id"');
	expect(body).toContain('value="123"');
	expect(body).toMatch(/name="title"[^>]*value="Eiffel Tower"/);
});

test('PoiForm without prefill omits detail_place_id', () => {
	const { body } = render(PoiForm, { props: { prefill: null } });
	expect(body).not.toContain('detail_place_id');
});

test('PoiForm and BoatForm forward errors', () => {
	for (const Form of [PoiForm, BoatForm]) {
		const { body } = render(Form, { props: { errors: { title: 'Name it.', venue: 'Where?' } } });
		expect(body).toContain('Name it.');
		expect(body).toContain('Where?');
	}
});

test('PoiForm and BoatForm read their strings from the catalog, not literals', () => {
	const poiSource = readFileSync(new URL('./PoiForm.svelte', import.meta.url), 'utf8');
	const boatSource = readFileSync(new URL('./BoatForm.svelte', import.meta.url), 'utf8');
	for (const [source, table, prefix] of [
		[poiSource, expectedPoiMessages, 'poi'],
		[boatSource, expectedBoatMessages, 'boat']
	] as const) {
		expect(source).toContain("from '$lib/paraglide/messages'");
		const used = [...new Set([...source.matchAll(new RegExp(`m\\.(${prefix}_[a-z_]+)\\(\\)`, 'g'))].map(([, key]) => key))].sort();
		expect(used).toEqual(Object.keys(table).sort());
	}
});

test('PoiForm and BoatForm no longer hardcode their visible strings', () => {
	const poiSource = readFileSync(new URL('./PoiForm.svelte', import.meta.url), 'utf8');
	const boatSource = readFileSync(new URL('./BoatForm.svelte', import.meta.url), 'utf8');
	for (const source of [poiSource, boatSource]) {
		expect(source).not.toMatch(/\b(?:title|location)(?:Label|Placeholder)="[^"]*"/);
	}
	expect(poiSource).not.toContain('requireEnd');
});
