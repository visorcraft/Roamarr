import { render } from 'svelte/server';
import { test, expect, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$app/state', () => ({ page: { url: new URL('http://x/') } }));

function fixture(filters: Record<string, unknown> = {}) {
	return {
		filters: { q: '', status: '', favorite: false, categoryId: null, ...filters },
		categories: [],
		places: [],
		markers: [],
		gpxTracks: [],
		map: null
	};
}

test('no filters and no places renders the empty state with an Add place button', () => {
	const { body } = render(Page, { props: { data: fixture() } as any });
	expect(body).toContain('empty-icon');
	expect(body).toContain('No saved places yet.');
	expect(body).toMatch(/<button[^>]*class="btn btn-primary mt-1"[^>]*>[\s\S]{0,40}?Add place<\/button>/);
	expect(body).not.toContain('Clear filters');
	expect(body).not.toContain('No places match these filters.');
	expect(body).not.toContain('Add your first place');
});

test('q filter with no places renders the empty state with a Clear filters link', () => {
	const { body } = render(Page, { props: { data: fixture({ q: 'Paris' }) } as any });
	expect(body).toContain('empty-icon');
	expect(body).toContain('No places match these filters.');
	expect(body).toMatch(/<a[^>]*href="\/places"[^>]*class="btn btn-primary mt-1"[^>]*>[\s\S]{0,40}?Clear filters<\/a>/);
	expect(body).not.toContain('No saved places yet.');
	expect(body).not.toMatch(/<button[^>]*class="btn btn-primary mt-1"/);
});

test.each([
	{ status: 'visited' },
	{ favorite: true },
	{ categoryId: 7 }
])('active filter %o renders the empty state with a Clear filters link', (filters) => {
	const { body } = render(Page, { props: { data: fixture(filters) } as any });
	expect(body).toContain('No places match these filters.');
	expect(body).toContain('Clear filters');
	expect(body).not.toContain('No saved places yet.');
});
