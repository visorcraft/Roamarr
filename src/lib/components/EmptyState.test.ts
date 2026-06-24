import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import EmptyState from './EmptyState.svelte';

test('renders message with default icon', () => {
	const { body } = render(EmptyState, { props: { message: 'Nothing here yet.' } });
	expect(body).toContain('Nothing here yet.');
	expect(body).toContain('card');
	expect(body).toContain('rounded-full');
	// Default plus icon
	expect(body).toContain('<circle');
	expect(body).not.toContain('Action');
});

test('applies card styling and centering classes', () => {
	const { body } = render(EmptyState, { props: { message: 'Nothing here.' } });
	expect(body).toContain('Nothing here.');
	expect(body).toContain('place-items-center');
	expect(body).toContain('text-center');
	expect(body).toContain('p-12');
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
