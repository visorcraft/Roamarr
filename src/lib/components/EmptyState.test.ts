import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import EmptyState from './EmptyState.svelte';

test('renders message with default icon', () => {
	const { body } = render(EmptyState, { props: { message: 'Nothing here yet.' } });
	expect(body).toContain('Nothing here yet.');
	expect(body).toContain('empty-state');
	expect(body).toContain('empty-icon');
	// Default plus icon
	expect(body).toContain('<circle');
	expect(body).not.toContain('Action');
});

test('applies card styling and centering classes', () => {
	const { body } = render(EmptyState, { props: { message: 'Nothing here.' } });
	expect(body).toContain('Nothing here.');
	expect(body).toContain('empty-state');
	expect(body).toContain('empty-icon');
});

test('renders action button when href and label provided', () => {
	const { body } = render(EmptyState, {
		props: {
			message: 'Get started.',
			actionHref: '/new',
			actionLabel: 'Create one'
		}
	});
	expect(body).toContain('Get started.');
	expect(body).toContain('href="/new"');
	expect(body).toContain('Create one');
	expect(body).toContain('btn btn-primary');
});

test('renders a client-side action button when onAction is provided', () => {
	const { body } = render(EmptyState, {
		props: {
			message: 'Get started.',
			actionLabel: 'Add place',
			onAction: () => {}
		}
	});
	expect(body).toMatch(/<button[^>]*type="button"/);
	expect(body).toMatch(/<button[^>]*class="btn btn-primary mt-1"/);
	expect(body).toMatch(/>Add place<\/button>/);
	expect(body).not.toContain('<a ');
});

test('onAction wins over actionHref when both are passed', () => {
	const { body } = render(EmptyState, {
		props: {
			message: 'Get started.',
			actionHref: '/places',
			actionLabel: 'Clear filters',
			onAction: () => {}
		}
	});
	expect(body).toContain('<button');
	expect(body).toContain('Clear filters');
	expect(body).not.toContain('<a ');
});

test('renders no control when only a label is provided', () => {
	const { body } = render(EmptyState, {
		props: {
			message: 'Get started.',
			actionLabel: 'Orphan'
		}
	});
	expect(body).not.toContain('<button');
	expect(body).not.toContain('<a ');
	expect(body).not.toContain('Orphan');
});
