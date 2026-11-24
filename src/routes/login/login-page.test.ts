import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import { test, expect, vi } from 'vitest';
import LoginPage from './+page.svelte';

const mockPage = vi.hoisted(() => ({ url: new URL('http://x/login') }));
vi.mock('$app/state', () => ({ page: mockPage }));

test('renders the login copy from the English message catalog', () => {
	mockPage.url = new URL('http://x/login');
	const { body } = render(LoginPage, {
		props: {
			data: { passkeyAvailable: true, allowRegistration: true, oidc: { enabled: true, displayName: 'Keycloak' } },
			form: null
		} as any
	});
	// Assert on whole elements: a bare 'Sign in' would also match the passkey and SSO buttons.
	for (const html of [
		'<h1 class="auth-title">Sign in</h1>',
		'<p class="page-subtitle">Welcome back to your travel HQ.</p>',
		'<label class="label" for="email">Email</label>',
		'<label class="label" for="password">Password</label>',
		'<a href="/forgot-password" class="text-sm link">Forgot password?</a>',
		'<button type="submit" class="btn btn-primary">Sign in</button>',
		'<button class="btn btn-primary w-full">Sign in with a passkey</button>',
		'<a href="/auth/oidc/start" class="btn btn-primary w-full text-center">Sign in with Keycloak</a>',
		'Need an account? <a href="/register" class="link">Create one</a>'
	]) {
		expect(body).toContain(html);
	}
});

test('drops off-site backslash next values from SSO href and uses safeNextPath for passkey redirect', () => {
	mockPage.url = new URL('http://x/login?next=/%5Cevil.example');
	const { body } = render(LoginPage, {
		props: {
			data: { passkeyAvailable: true, allowRegistration: false, oidc: { enabled: true, displayName: 'Keycloak' } },
			form: null
		} as any
	});
	expect(body).toContain('href="/auth/oidc/start"');
	expect(body).not.toContain('evil.example');
	const src = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');
	expect(src).toContain("import { safeNextPath } from '$lib/safeNextPath'");
	expect(src).not.toContain("startsWith('/')");
});

test('themes the passkey and SSO dividers with the theme line colour', () => {
	mockPage.url = new URL('http://x/login');
	const withPasskey = render(LoginPage, {
		props: {
			data: { passkeyAvailable: true, allowRegistration: true, oidc: { enabled: true, displayName: 'Keycloak' } },
			form: null
		} as any
	});
	expect(withPasskey.body).toMatch(/class="mt-4 border-t border-line pt-4">\s*<button class="btn btn-primary w-full">Sign in with a passkey<\/button>/);
	expect(withPasskey.body).toMatch(/class="mt-4\s*">\s*<a href="\/auth\/oidc\/start"/);

	mockPage.url = new URL('http://x/login');
	const withoutPasskey = render(LoginPage, {
		props: {
			data: { passkeyAvailable: false, allowRegistration: true, oidc: { enabled: true, displayName: 'Keycloak' } },
			form: null
		} as any
	});
	expect(withoutPasskey.body).toMatch(/class="mt-4 border-t border-line pt-4">\s*<a href="\/auth\/oidc\/start"/);
	expect(withoutPasskey.body).not.toContain('Sign in with a passkey');

	for (const body of [withPasskey.body, withoutPasskey.body]) {
		expect(body).not.toContain('border-slate-');
		expect(body).not.toContain('dark:');
		expect(body).not.toContain('border-white/');
	}

	const src = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');
	expect(src).not.toContain('dark:');
});
