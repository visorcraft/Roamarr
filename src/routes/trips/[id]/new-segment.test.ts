import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import NewFlightSegmentPage from './segments/new/flight/+page.svelte';

function makeData(errors: Record<string, string> = {}): any {
	return {
		data: {
			trip: { id: 1, name: 'Trip' },
			type: 'flight',
			label: 'Flight'
		},
		form: { errors, type: 'flight' }
	};
}

test('new flight segment page highlights invalid fields', () => {
	const { body } = render(NewFlightSegmentPage, {
		props: makeData({
			title: 'title is required',
			cityName: 'cityName is required'
		})
	});
	expect(body).toContain('input-error');
	expect(body).toContain('title is required');
	expect(body).toContain('cityName is required');
	expect(body).toContain('Country');
	expect(body).toContain('City');
});
