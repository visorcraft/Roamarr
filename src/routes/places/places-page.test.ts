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

test('photos and links buttons carry accessible names with counts', () => {
	const { body } = render(Page, {
		props: {
			data: fixture({}, {
				places: [placeFixture()],
				galleries: { 1: [{}, {}] },
				linksByPlace: { 1: [{}] }
			})
		} as any
	});
	expect(body).toMatch(/<button(?=[^>]*aria-label="Photos \(2\) for Eiffel Tower")(?=[^>]*aria-expanded="false")[^>]*>/);
	expect(body).toMatch(/<button(?=[^>]*aria-label="Links \(1\) for Eiffel Tower")(?=[^>]*aria-expanded="false")[^>]*>/);
});

test('photos and links buttons carry accessible names with zero counts', () => {
	const { body } = render(Page, {
		props: { data: fixture({}, { places: [placeFixture()] }) } as any
	});
	expect(body).toMatch(/<button(?=[^>]*aria-label="Photos \(0\) for Eiffel Tower")(?=[^>]*aria-expanded="false")[^>]*>/);
	expect(body).toMatch(/<button(?=[^>]*aria-label="Links \(0\) for Eiffel Tower")(?=[^>]*aria-expanded="false")[^>]*>/);
});

test('favourite and visited toggles expose state via aria-pressed', () => {
	const { body } = render(Page, {
		props: {
			data: fixture({}, { places: [placeFixture({ favorite: true, status: 'visited' })] })
		} as any
	});
	expect(body).toMatch(/<button(?=[^>]*aria-label="Favorite Eiffel Tower")(?=[^>]*aria-pressed="true")[^>]*>/);
	expect(body).toMatch(/<button(?=[^>]*aria-label="Visited Eiffel Tower")(?=[^>]*aria-pressed="true")[^>]*>/);
});

test('favourite and visited toggles expose false state by default', () => {
	const { body } = render(Page, {
		props: { data: fixture({}, { places: [placeFixture()] }) } as any
	});
	expect(body).toMatch(/<button(?=[^>]*aria-label="Favorite Eiffel Tower")(?=[^>]*aria-pressed="false")[^>]*>/);
	expect(body).toMatch(/<button(?=[^>]*aria-label="Visited Eiffel Tower")(?=[^>]*aria-pressed="false")[^>]*>/);
});

test('edit and delete controls carry accessible names', () => {
	const { body } = render(Page, {
		props: { data: fixture({}, { places: [placeFixture()] }) } as any
	});
	expect(body).toMatch(/<button(?=[^>]*aria-label="Edit Eiffel Tower")[^>]*>/);
	expect(body).toMatch(/<button(?=[^>]*aria-label="Delete Eiffel Tower")[^>]*>/);
});

test('gpx track branch exposes download link and remove control', () => {
	const { body } = render(Page, {
		props: { data: fixture({}, { places: [placeFixture({ gpxAttachmentId: 9 })] }) } as any
	});
	expect(body).toMatch(/<a(?=[^>]*href="\/places\/1\/gpx")(?=[^>]*aria-label="Download GPX track for Eiffel Tower")[^>]*>/);
	expect(body).toMatch(/<button(?=[^>]*aria-label="Remove GPX track for Eiffel Tower")[^>]*>/);
	expect(body).not.toContain('Attach GPX track');
});

test('attach gpx label names the file input and shows a focus ring', () => {
	const { body } = render(Page, {
		props: { data: fixture({}, { places: [placeFixture()] }) } as any
	});
	expect(body).toMatch(/<label(?=[^>]*focus-within:ring-2)(?=[^>]*focus-within:ring-\(--theme-brand\))(?=[^>]*focus-within:ring-offset-canvas)[^>]*>[\s\S]{0,400}?<span class="sr-only">Attach GPX track<\/span>[\s\S]{0,200}?<input(?=[^>]*type="file")(?=[^>]*name="file")[^>]*>/);
});

test('delete category button carries an accessible name', () => {
	const { body } = render(Page, {
		props: {
			data: fixture({}, {
				places: [placeFixture()],
				categories: [{ id: 7, name: 'Museums', color: '#ff0000' }]
			})
		} as any
	});
	expect(body).toMatch(/<button(?=[^>]*aria-label="Delete category Museums")[^>]*>/);
});
