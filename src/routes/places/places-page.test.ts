import { render } from 'svelte/server';
import { test, expect, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$app/state', () => ({ page: { url: new URL('http://x/') } }));

function fixture(filters: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
	return {
		filters: { q: '', status: '', favorite: false, categoryId: null, ...filters },
		categories: [],
		places: [],
		markers: [],
		gpxTracks: [],
		galleries: {},
		linksByPlace: {},
		map: null,
		...extra
	};
}

function placeFixture(overrides: Record<string, unknown> = {}) {
	return {
		id: 1,
		name: 'Eiffel Tower',
		favorite: false,
		status: 'planned',
		categoryId: null,
		address: null,
		description: null,
		gpxAttachmentId: null,
		...overrides
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

test('favorite place renders a filled themed star with a screen-reader label', () => {
	const { body } = render(Page, {
		props: { data: fixture({}, { places: [placeFixture({ favorite: true })] }) } as any
	});
	expect(body).toContain('class="shrink-0 h-4 w-4 fill-current text-[var(--theme-readable-warning)]"');
	expect(body).toMatch(/<span class="sr-only">Favorite<\/span>/);
	expect(body).not.toContain('text-amber-500');
});

test('non-favorite place renders no favorite label', () => {
	const { body } = render(Page, {
		props: { data: fixture({}, { places: [placeFixture({ favorite: false })] }) } as any
	});
	expect(body).not.toContain('<span class="sr-only">Favorite</span>');
	expect(body).not.toContain('text-amber-500');
});

test('uncategorized place exposes the colour dot with an accessible name', () => {
	const { body } = render(Page, {
		props: { data: fixture({}, { places: [placeFixture({ categoryId: null })], categories: [] }) } as any
	});
	expect(body).toMatch(/<span[^>]*role="img"[^>]*aria-label="Uncategorized"[^>]*><\/span>/);
	expect(body).not.toMatch(/<span[^>]*role="img"[^>]*aria-hidden/);
});

test('categorized place hides the duplicate dot and keeps the badge', () => {
	const { body } = render(Page, {
		props: {
			data: fixture({}, {
				places: [placeFixture({ categoryId: 7 })],
				categories: [{ id: 7, name: 'Museums', color: '#ff0000' }]
			})
		} as any
	});
	expect(body).toMatch(/<span[^>]*title="Museums"[^>]*aria-hidden="true"[^>]*><\/span>/);
	expect(body).not.toContain('aria-label="Uncategorized"');
	expect(body).not.toMatch(/<span[^>]*role="img"/);
	expect(body).toContain('Museums');
});
