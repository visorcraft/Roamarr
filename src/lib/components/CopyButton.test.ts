import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import CopyButton from './CopyButton.svelte';

test('renders a copy button with default label', () => {
	const { body } = render(CopyButton, { props: { text: 'https://example.com/feed' } });
	expect(body).toContain('<button');
	expect(body).toContain('type="button"');
	expect(body).toContain('Copy');
	expect(body).toContain('aria-live="polite"');
});

test('renders custom labels and classes', () => {
	const { body } = render(CopyButton, {
		props: {
			text: 'https://example.com/share',
			label: 'Copy link',
			copiedLabel: 'Link copied!',
			class: 'btn btn-ghost btn-sm'
		}
	});
	expect(body).toContain('Copy link');
	expect(body).toContain('btn btn-ghost btn-sm');
});
