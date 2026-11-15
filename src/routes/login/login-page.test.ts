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
	for (const text of [
		'Sign in',
		'Welcome back to your travel HQ.',
		'Forgot password?',
		'Sign in with a passkey',
		'Sign in with Keycloak',
		'Need an account?',
		'Create one'
	]) {
		expect(body).toContain(text);
	}
});
