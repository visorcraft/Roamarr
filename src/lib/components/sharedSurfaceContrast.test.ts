import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';

// EmptyState and CollapseSection paint their text from theme tokens, not fixed Tailwind palette
// classes, so the message and section titles stay readable on Light and High-Contrast-Light.

const emptyState = readFileSync(new URL('./EmptyState.svelte', import.meta.url), 'utf8');
const collapseSection = readFileSync(new URL('./segments/CollapseSection.svelte', import.meta.url), 'utf8');

test('EmptyState message follows the selected theme', () => {
	expect(emptyState).not.toMatch(/\b(?:text|bg)-(?:white|slate-\d{2,3}|indigo-\d{2,3})\b/);
	expect(emptyState).toContain('text-[var(--theme-ink)]');
});

test('CollapseSection title follows the selected theme', () => {
	expect(collapseSection).not.toMatch(/\b(?:text|bg)-(?:white|slate-\d{2,3}|indigo-\d{2,3})\b/);
	expect(collapseSection).toContain('text-[var(--theme-ink)]');
	expect(collapseSection).toContain('aria-expanded={open}');
	expect(collapseSection).toContain('aria-controls={panelId}');
});
