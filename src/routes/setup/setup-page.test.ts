import { test, expect } from 'vitest';
import { render } from 'svelte/server';
import SetupPage from './+page.svelte';
import { checkA11y, formatViolations } from '../../../tests/a11y';

const passingChecksData = {
	missingSecret: false,
	bootError: null,
	setupCheck: { secretPresent: true, encrypted: true, writable: false, error: null }
};

const errorData = {
	missingSecret: false,
	bootError: null,
	setupCheck: {
		secretPresent: false,
		encrypted: false,
		writable: false,
		error: '<data>/roamarr-db: EACCES ' + 'x'.repeat(200)
	}
};

const bootErrorData = {
	missingSecret: false,
	bootError: 'boom: invalid secret',
	setupCheck: { secretPresent: true, encrypted: true, writable: true, error: null }
};

function renderPage(data: typeof passingChecksData | typeof errorData | typeof bootErrorData) {
	return render(SetupPage, { props: { data, form: null } as any });
}

function continueTag(body: string) {
	const match = body.match(/<button\b[^>]*>\s*Continue/);
	expect(match).not.toBeNull();
	return match![0].match(/^<button\b[^>]*>/)![0];
}

test('passing checks use the success token, failing checks the danger token', () => {
	const { body } = renderPage(passingChecksData);
	expect(body).toMatch(
		/<li class="flex items-center gap-2 text-\[var\(--theme-readable-success\)\]">[\s\S]*?ROAMARR_SECRET is set<\/span>/
	);
	expect(body).toMatch(
		/<li class="flex items-center gap-2 text-\[var\(--theme-readable-success\)\]">[\s\S]*?Database encryption verified<\/span>/
	);
	expect(body).toMatch(
		/<li class="flex items-center gap-2 text-\[var\(--theme-readable-danger\)\]">[\s\S]*?Database not writable<\/span>/
	);
	expect(body).not.toMatch(/text-green-600|text-red-600|bg-red-50|text-red-800/);
	expect(continueTag(body)).toContain('disabled');
});

test('setupCheck error renders as the themed, wrappable notice and is escaped', () => {
	const { body } = renderPage(errorData);
	expect(body).toContain(
		'<div class="notice notice-error mt-3 font-mono whitespace-pre-wrap [overflow-wrap:anywhere]">'
	);
	expect(body).toContain('&lt;data>/roamarr-db: EACCES');
	expect(body).not.toContain('<data>');
	expect(body).toContain('x'.repeat(200));
	expect(body).not.toContain('bg-red-50');
	expect(body).not.toContain('text-red-800');
	expect(body.match(/text-\[var\(--theme-readable-danger\)\]/g)).toHaveLength(3);
});

test('bootError is shown when setupCheck.error is absent', () => {
	const { body } = renderPage(bootErrorData);
	expect(body).toContain('notice notice-error');
	expect(body).toContain('boom: invalid secret');
	expect(body.match(/text-\[var\(--theme-readable-success\)\]/g)).toHaveLength(3);
	expect(continueTag(body)).not.toContain('disabled');
});

test('axe: no violations in any state', async () => {
	for (const data of [passingChecksData, errorData, bootErrorData]) {
		const violations = await checkA11y(SetupPage, { data, form: null } as any);
		expect(violations, formatViolations(violations)).toHaveLength(0);
	}
});
