import { render } from 'svelte/server';
import { test, expect, vi } from 'vitest';
import SecurityPage from './+page.svelte';

const mockPage = vi.hoisted(() => ({ url: new URL('http://localhost/profile/security') }));
vi.mock('$app/state', () => ({ page: mockPage }));
vi.mock('$app/forms', () => ({ enhance: () => {} }));
vi.mock('@simplewebauthn/browser', () => ({ startRegistration: vi.fn() }));

function buildData() {
	return {
		state: { enabled: false, enabledAt: null, backupCodesRemaining: 0 },
		setup: { secret: 'SECRET', otpauthUri: 'otpauth://totp/x', qr: 'data:image/png;base64,x' },
		passkeys: [],
		available: false,
		clients: [],
		tokens: [],
		allScopes: [],
		scopeDescriptions: {},
		mcpUrl: 'http://localhost/mcp'
	} as any;
}

test('default form renders current password first with autocomplete tokens', () => {
	const { body } = render(SecurityPage, {
		props: { data: buildData(), form: undefined } as any
	});
	expect(body.indexOf('name="oldPassword"')).toBeLessThan(body.indexOf('name="newPassword"'));
	expect(body.indexOf('name="newPassword"')).toBeLessThan(body.indexOf('name="confirmPassword"'));
	expect(body).toContain('autocomplete="current-password"');
	expect(body.split('autocomplete="new-password"').length - 1).toBe(2);
	expect(body).toContain('aria-busy="false"');
	expect(body).not.toContain('aria-invalid');
	expect(body).not.toContain('role="alert"');
});

test('field failure renders the alert summary and field errors', () => {
	const { body } = render(SecurityPage, {
		props: {
			data: buildData(),
			form: {
				error: 'Password not changed. Fix the highlighted fields.',
				errors: { confirmPassword: 'Passwords do not match.' }
			}
		} as any
	});
	expect(body).toContain('role="alert"');
	expect(body).toContain('aria-invalid="true"');
	expect(body).toContain('aria-describedby="confirmPassword-confirmPassword-error"');
	expect(body).toContain('id="confirmPassword-confirmPassword-error">Passwords do not match.');
	expect(body.split('Password not changed. Fix the highlighted fields.').length - 1).toBe(1);
});

test('form-level failure renders the alert without field errors', () => {
	const { body } = render(SecurityPage, {
		props: {
			data: buildData(),
			form: { error: 'Current password is incorrect.', errors: {} }
		} as any
	});
	expect(body).toContain('role="alert"');
	expect(body.split('Current password is incorrect.').length - 1).toBe(1);
	expect(body).not.toContain('aria-invalid');
});

test('other actions keep the page-level notice and no alert', () => {
	const { body } = render(SecurityPage, {
		props: {
			data: buildData(),
			form: { error: 'Enter the 6-digit code from your authenticator app.' }
		} as any
	});
	expect(body).toContain('class="notice notice-error mt-6"');
	expect(body).toContain('Enter the 6-digit code from your authenticator app.');
	expect(body).not.toContain('role="alert"');
});
