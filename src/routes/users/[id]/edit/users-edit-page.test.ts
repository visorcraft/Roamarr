import { render } from 'svelte/server';
import { test, expect, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$app/forms', () => ({ enhance: () => {} }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

function buildData(twoFactorEnabled: boolean) {
	return {
		user: {
			id: 7,
			email: 'target@x.c',
			displayName: 'Target',
			role: 'user',
			disabled: false,
			mustResetPassword: false
		},
		twoFactorEnabled
	} as any;
}

test('dividers use the theme line token', () => {
	const { body } = render(Page, {
		props: { data: buildData(false), form: null } as any
	});
	expect(body.split('border-line').length - 1).toBe(2);
	expect(body).not.toContain('border-white/5');
});

test('2FA reset control is a confirm trigger with a dialog', () => {
	const { body } = render(Page, {
		props: { data: buildData(true), form: null } as any
	});
	expect(body).toMatch(
		/<button[^>]*type="button"[^>]*>(?:<!--[^>]*-->|\s)*Disable user 2FA \(admin reset\)(?:<!--[^>]*-->|\s)*<\/button>/
	);
	expect(body).toContain('<dialog');
	expect(body).toContain('Disable two-factor authentication for this user?');
	expect(body).toMatch(/<button[^>]*type="submit"[^>]*>\s*Confirm\s*<\/button>/);
});

test('2FA reset control is not a direct submit button', () => {
	const { body } = render(Page, {
		props: { data: buildData(true), form: null } as any
	});
	expect(body).not.toMatch(/<button(?![^>]*type="button")[^>]*>\s*Disable user 2FA/);
});

test('2FA reset control is hidden when 2FA is disabled', () => {
	const { body } = render(Page, {
		props: { data: buildData(false), form: null } as any
	});
	expect(body).not.toContain('Disable user 2FA');
	expect(body).not.toContain('Disable two-factor authentication for this user?');
});
