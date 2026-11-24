import { readFileSync } from 'node:fs';
import { test, expect, vi, beforeEach } from 'vitest';
import { render } from 'svelte/server';
import VerifyPage from './+page.svelte';
import { checkA11y, formatViolations } from '../../../../tests/a11y';

const pageState = vi.hoisted(() => ({ status: 200, form: null as null | { error?: string } }));
vi.mock('$app/state', () => ({ page: pageState }));

beforeEach(() => {
	pageState.status = 200;
	pageState.form = null;
});

const inputTag = (html: string) => html.match(/<input\b[^>]*>/)![0];

test('clean load', () => {
	const { body } = render(VerifyPage);
	expect(body).toContain('<label class="label" for="code">Authentication code</label>');
	expect(body).toContain('<a href="/login" class="link">Back to login</a>');
	const input = inputTag(body);
	expect(input).toContain('id="code"');
	expect(input).toContain('name="code"');
	expect(input).toContain('autocomplete="one-time-code"');
	expect(input).toContain('inputmode="numeric"');
	expect(input).toContain('required');
	expect(input).not.toContain('aria-invalid');
	expect(input).not.toContain('aria-describedby');
	expect(input).not.toContain('input-error');
	expect(body).not.toContain('notice-error');
	expect(body).not.toContain('verify-error');
});

test('invalid code (401)', () => {
	pageState.status = 401;
	pageState.form = { error: 'Invalid code. Try again.' };
	const { body } = render(VerifyPage);
	expect(body).toContain(
		'<p id="verify-error" class="notice notice-error mb-4 text-center">Invalid code. Try again.</p>'
	);
	const input = inputTag(body);
	expect(input).toContain('aria-invalid="true"');
	expect(input).toContain('aria-describedby="verify-error"');
	expect(input).toMatch(/\binput-error\b/);
});

test('blank code (400) and rate limited (429)', () => {
	pageState.status = 400;
	pageState.form = { error: 'Enter your 6-digit code or a backup code.' };
	let body = render(VerifyPage).body;
	expect(body).toContain(
		'<p id="verify-error" class="notice notice-error mb-4 text-center">Enter your 6-digit code or a backup code.</p>'
	);
	expect(inputTag(body)).toContain('aria-invalid="true"');

	pageState.status = 429;
	pageState.form = { error: 'Too many attempts. Try again later.' };
	body = render(VerifyPage).body;
	expect(body).toContain(
		'<p id="verify-error" class="notice notice-error mb-4 text-center">Too many attempts. Try again later.</p>'
	);
	expect(inputTag(body)).toContain('aria-invalid="true"');
});

test('axe: no violations in the 401 state', async () => {
	pageState.status = 401;
	pageState.form = { error: 'Invalid code. Try again.' };
	const violations = await checkA11y(VerifyPage, {});
	expect(violations, formatViolations(violations)).toHaveLength(0);
});

test('no fixed palette classes', () => {
	const source = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');
	expect(source).not.toMatch(/\b(?:text|bg|border)-(?:white|slate-\d{2,3}|indigo-\d{2,3}|red-\d{2,3})\b/);
});
