import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import StandardPlanForm from './StandardPlanForm.svelte';
import BoatForm from './BoatForm.svelte';
import HotelForm from './HotelForm.svelte';
import FoodForm from './FoodForm.svelte';
import TrainForm from './TrainForm.svelte';

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

test('delegate forms add their extra fields on top of StandardPlanForm', () => {
	const hotel = render(HotelForm, { props: {} }).body;
	expect(hotel).toContain('name="detail_phone"');
	expect(hotel).toContain('Check-out time');
	expect(render(FoodForm, { props: {} }).body).toContain('name="detail_partySize"');
	expect(render(TrainForm, { props: {} }).body).toContain('name="detail_seat"');
	// BoatForm is a pure wrapper (labels only) and still surfaces the base fields
	expect(render(BoatForm, { props: {} }).body).toContain('name="title"');
});
