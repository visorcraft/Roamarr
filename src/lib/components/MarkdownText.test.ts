import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import MarkdownText from './MarkdownText.svelte';

test('renders markdown formatting to HTML', () => {
	const { body } = render(MarkdownText, { props: { text: '**bold** and _em_' } });
	expect(body).toContain('<strong>bold</strong>');
	expect(body).toContain('<em>em</em>');
});

test('escapes raw HTML instead of passing it through', () => {
	const { body } = render(MarkdownText, { props: { text: '<script>alert(1)</script>' } });
	expect(body).not.toContain('<script>');
	expect(body).toContain('&lt;script&gt;');
});

test('renders nothing for empty text', () => {
	const { body } = render(MarkdownText, { props: { text: '' } });
	expect(body).not.toContain('markdown-body');
});

test('applies the optional class to the wrapper', () => {
	const { body } = render(MarkdownText, { props: { text: 'hi', class: 'text-sm' } });
	expect(body).toMatch(/class="markdown-body text-sm"/);
});
