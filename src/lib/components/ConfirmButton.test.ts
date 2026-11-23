import { render } from 'svelte/server';
import type { Snippet } from 'svelte';
import { test, expect } from 'vitest';
import { m } from '$lib/paraglide/messages';
import ConfirmButton from './ConfirmButton.svelte';

test('renders default labels from the catalog', () => {
	const { body } = render(ConfirmButton, {
		props: {
			message: 'Delete this card?',
			children: ((r: { push: (markup: string) => void }) => r.push('Delete')) as unknown as Snippet
		}
	});
	expect(body).toContain(m.common_confirm_title());
	expect(body).toContain(m.common_confirm());
	expect(body).toContain(m.common_cancel());
	expect(body).toContain('Delete this card?');
	expect(body).toContain('type="submit"');
});

test('renders caller-supplied title and confirmLabel verbatim', () => {
	const { body } = render(ConfirmButton, {
		props: {
			message: 'Delete this card?',
			title: 'Custom title',
			confirmLabel: 'Custom confirm',
			children: ((r: { push: (markup: string) => void }) => r.push('Delete')) as unknown as Snippet
		}
	});
	expect(body).toContain('Custom title');
	expect(body).toContain('Custom confirm');
	expect(body).toContain('Delete this card?');
	expect(body).not.toContain(m.common_confirm_title());
	expect(body).not.toContain(m.common_confirm());
});

test('pins the English default strings', () => {
	expect(m.common_confirm_title()).toBe('Are you sure?');
	expect(m.common_confirm()).toBe('Confirm');
	expect(m.common_cancel()).toBe('Cancel');
});
