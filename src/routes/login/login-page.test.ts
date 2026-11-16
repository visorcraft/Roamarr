import { render } from 'svelte/server';
import { test, expect, vi } from 'vitest';
import LoginPage from './+page.svelte';

vi.mock('$app/state', () => ({ page: { url: new URL('http://x/login') } }));

test('renders the login copy from the English message catalog', () => {
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
