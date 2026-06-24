import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import TripDetailPage from './+page.svelte';

function makeData(errors: Record<string, string> = {}): any {
	const trip = {
		id: 1,
		name: 'Trip',
		destination: 'Destination',
		startDate: '2026-07-01',
		endDate: '2026-07-10',
		notes: null,
		publicToken: null,
		calendarToken: null,
		defaultVisibility: 'private',
		ownerId: 1,
		createdAt: '',
		updatedAt: ''
	};
	const segment = {
		id: 1,
		tripId: 1,
		type: 'flight',
		title: 'UA1',
		startAt: '2026-07-01T12:00:00.000Z',
		startTz: 'UTC',
		endAt: null,
		location: null,
		confirmationNumber: null,
		cardId: null,
		detailsJson: null,
		createdAt: '',
		updatedAt: ''
	};
	return {
		data: {
			user: { displayName: 'A', role: 'user' },
			instanceName: 'Roamarr',
			flash: undefined,
			editor: true,
			owner: true,
			trip,
			segments: [segment],
			providers: [],
			watches: [],
			feedUrl: null
		},
		form: { errors }
	};
}

test('trip detail highlights invalid fields on the add segment form', () => {
	const { body } = render(TripDetailPage, {
		props: makeData({
			title: 'title is required',
			localStart: 'localStart must be a valid datetime'
		})
	});
	expect(body).toContain('input-error');
	expect(body).toContain('title is required');
	expect(body).toContain('localStart must be a valid datetime');
});
