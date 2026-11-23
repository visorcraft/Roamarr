import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';
import { render } from 'svelte/server';
import { checkA11y, formatViolations } from '../../../tests/a11y';
import PasswordStrength from './PasswordStrength.svelte';

test('empty password renders nothing', () => {
	const { body } = render(PasswordStrength, { props: { password: '' } });
	expect(body).not.toContain('role="meter"');
});

const cases = [
	{ password: 'abcdefgh', s: 0, label: 'Very weak', tone: 'text-[var(--theme-readable-danger)]' },
	{ password: 'abcdefg!', s: 1, label: 'Weak', tone: 'text-[var(--theme-readable-danger)]' },
	{ password: 'Abcdefgh1', s: 2, label: 'Fair', tone: 'text-[var(--theme-readable-warning)]' },
	{ password: 'AbcdEfgh12!', s: 3, label: 'Strong', tone: 'text-[var(--theme-readable-success)]' },
	{ password: 'Abcdefgh123!', s: 4, label: 'Very strong', tone: 'text-[var(--theme-readable-success)]' }
];

test('score maps to value, label and tone', () => {
	for (const { password, s, label, tone } of cases) {
		const { body } = render(PasswordStrength, { props: { password } });
		expect(body).toContain(`aria-valuenow="${s}"`);
		expect(body).toContain(label);
		expect(body).toContain(tone);
	}
});

test('meter exposes semantics', () => {
	const { body } = render(PasswordStrength, { props: { password: 'AbcdEfgh12!' } });
	expect(body).toContain('aria-valuemin="0"');
	expect(body).toContain('aria-valuemax="4"');
	expect(body).toContain('aria-label="Password strength"');
	expect(body).toContain('aria-live="polite"');
});

test('PasswordStrength has no axe violations', async () => {
	const violations = await checkA11y(PasswordStrength, { password: 'AbcdEfgh12!' });
	expect(violations, formatViolations(violations)).toHaveLength(0);
});

const source = readFileSync(new URL('./PasswordStrength.svelte', import.meta.url), 'utf8');

test('PasswordStrength source stays theme-aware and accessible', () => {
	expect(source).not.toMatch(/\b(?:text|bg)-(?:white|slate-\d{2,3}|indigo-\d{2,3})\b/);
	expect(source).not.toMatch(/\btext-(?:red|yellow|emerald|amber)-300\b/);
	expect(source).toContain('bg-[var(--theme-line)]');
	expect(source).toContain('role="meter"');
	expect(source).toContain('aria-valuenow={s}');
	expect(source).toContain('text-[var(--theme-readable-success)]');
	expect(source).toContain('text-[var(--theme-readable-warning)]');
	expect(source).toContain('text-[var(--theme-readable-danger)]');
});
