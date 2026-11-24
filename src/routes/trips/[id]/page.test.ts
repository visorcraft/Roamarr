import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';

// Source contract: the trip detail page statically imports the map, globe and
// gallery components, so this guard reads the Svelte source instead of
// SSR-rendering the page.
const source = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');

// Fixed-palette text utilities and typography-plugin classes must not sit on
// user-authored markdown: the text inherits --theme-ink from its themed panel.
const FIXED_TEXT_CLASS =
	/(?:^|\s)(?:prose(?:-invert)?|text-(?:slate|gray|zinc|neutral|stone|white|black)(?:-\d{2,3})?(?:\/\d+)?)(?=\s|$)/;

function markdownTextClasses(src: string): { line: number; classValue: string }[] {
	return [...src.matchAll(/<MarkdownText\b[^>]*>/g)].map((match) => ({
		line: src.slice(0, match.index).split('\n').length,
		classValue: /\bclass="([^"]*)"/.exec(match[0])?.[1] ?? ''
	}));
}

test('trip detail page keeps markdown free of fixed text colours', () => {
	const classes = markdownTextClasses(source);
	// Guards against a vacuous pass if the tag scan ever stops matching.
	expect(classes.length).toBeGreaterThanOrEqual(4);
	for (const { line, classValue } of classes) {
		expect(classValue, `line ${line}`).not.toMatch(FIXED_TEXT_CLASS);
	}
});

test('the Overview notes inherit the themed panel ink', () => {
	const match = /<MarkdownText\b[^>]*\btext=\{ownerTrip\.notes\}[^>]*>/.exec(source);
	expect(match, 'expected the Overview notes MarkdownText').not.toBeNull();
	const classValue = match ? (/\bclass="([^"]*)"/.exec(match[0])?.[1] ?? '') : '';
	expect(classValue).toBe('max-w-none text-sm leading-relaxed');
});
