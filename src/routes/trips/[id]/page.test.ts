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

test('prep checklist toggle exposes its packed state and has a touch-sized target', () => {
	const start = source.indexOf("{:else if activeTab === 'prep'}");
	const end = source.indexOf("{:else if activeTab === 'money'}", start);
	expect(start, 'expected the prep tab branch').toBeGreaterThan(-1);
	expect(end, 'expected the money tab branch after prep').toBeGreaterThan(start);
	const prep = source.slice(start, end);
	expect(prep).toContain('<button class="check-toggle min-h-11" type="submit" aria-pressed={item.packed}>');
	expect(prep).toMatch(/<span class="check-marker \{item\.packed \? 'check-marker-active' : ''\}" aria-hidden="true">/);
	expect(prep).toContain('placeholder="Add checklist item" aria-label="Checklist item" required');
	expect(prep).toContain('name="assignedToCompanionId" class="input w-auto text-sm" aria-label="Assigned to"');
});

test('expense deletion is confirmed in the shared dialog and named per row', () => {
	expect(source).toContain("import ConfirmButton from '$lib/components/ConfirmButton.svelte';");
	const form = /<form method="POST" action="\?\/deleteExpense">([\s\S]*?)<\/form>/.exec(source)?.[1] ?? '';
	expect(form, 'expected the deleteExpense form').not.toBe('');
	expect(form).toContain('<input type="hidden" name="expenseId" value={e.id} />');
	expect(form).toMatch(
		/<ConfirmButton\s+type="submit"\s+class="icon-button icon-button-sm"\s+aria-label=\{`Delete expense \$\{e\.description\}`\}\s+message=\{`Delete expense \$\{e\.description\}\? This cannot be undone\.`\}\s*>/
	);
	expect(form).toContain('<Icon name="close" class="h-3.5 w-3.5" /></ConfirmButton>');
	// The one-tap delete control and native confirm() must not come back.
	expect(source).not.toContain('aria-label="Delete expense"');
	expect(source).not.toMatch(/\b(?:window\.)?confirm\(/);
});
