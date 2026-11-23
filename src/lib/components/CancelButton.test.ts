import { render } from 'svelte/server';
import type { Snippet } from 'svelte';
import { test, expect } from 'vitest';
import { m } from '$lib/paraglide/messages';
import CancelButton from './CancelButton.svelte';

test('renders default labels from the catalog', () => {
	const { body } = render(CancelButton, {
		props: {
			onConfirm: () => {},
			children: ((r: { push: (markup: string) => void }) => r.push('Delete')) as unknown as Snippet
		}
	});
	expect(body).toContain(m.common_discard_title());
	expect(body).toContain(m.common_discard_message());
	expect(body).toContain(m.common_discard_cancel());
	expect(body).toContain(m.common_discard_confirm());
});

test('renders caller-supplied overrides verbatim', () => {
	const { body } = render(CancelButton, {
		props: {
			onConfirm: () => {},
			title: 'Custom title',
			message: 'Custom message',
			confirmLabel: 'Custom confirm',
			cancelLabel: 'Custom cancel',
			children: ((r: { push: (markup: string) => void }) => r.push('Delete')) as unknown as Snippet
		}
	});
	expect(body).toContain('Custom title');
	expect(body).toContain('Custom message');
	expect(body).toContain('Custom confirm');
	expect(body).toContain('Custom cancel');
	expect(body).not.toContain(m.common_discard_title());
	expect(body).not.toContain(m.common_discard_message());
	expect(body).not.toContain(m.common_discard_cancel());
	expect(body).not.toContain(m.common_discard_confirm());
});

test('pins the English default strings', () => {
	expect(m.common_discard_title()).toBe('Discard changes?');
	expect(m.common_discard_message()).toBe('Any unsaved changes will be lost.');
	expect(m.common_discard_confirm()).toBe('Discard changes');
	expect(m.common_discard_cancel()).toBe('Keep editing');
});
