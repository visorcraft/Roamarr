import { render } from 'svelte/server';
import { test, expect, vi } from 'vitest';
import ApiKeysPage from './+page.svelte';

vi.mock('$app/forms', () => ({ enhance: () => {} }));

function buildData() {
	return {
		keys: [],
		grantableScopes: ['trips:read', 'trips:write'],
		scopeDescriptions: { 'trips:read': 'Read trips', 'trips:write': 'Write trips' }
	} as any;
}

test('create form is enhanced, idle, and describes its hints', () => {
	const { body } = render(ApiKeysPage, {
		props: { data: buildData(), form: undefined } as any
	});
	expect(body).toContain('action="?/create"');
	expect(body).toContain('aria-busy="false"');
	expect(body).toContain('id="expiresAt-hint"');
	expect(body).toContain('aria-describedby="expiresAt-hint"');
	expect(body).toContain('role="group" aria-labelledby="scopes-label"');
	expect(body).toContain('aria-describedby="scopes-help"');
	expect(body).toContain('Create key');
	expect(body).not.toContain('Creating…');

	const scopeInput = body.match(/<input[^>]*value="trips:read"[^>]*>/);
	expect(scopeInput).toBeTruthy();
	expect(scopeInput![0]).toContain('checked');

	const button = body.match(/<button[^>]*>[^<]*Create key[^<]*<\/button>/);
	expect(button).toBeTruthy();
	expect(button![0]).not.toContain('disabled');
});

test('validation failure renders an alert and no secret banner', () => {
	const { body } = render(ApiKeysPage, {
		props: { data: buildData(), form: { error: 'Select at least one scope.' } } as any
	});
	expect(body).toContain('role="alert"');
	expect(body).toContain('Select at least one scope.');
	expect(body).not.toContain('Save your API key');
});

test('a created token renders the save banner with no alert', () => {
	const { body } = render(ApiKeysPage, {
		props: { data: buildData(), form: { createdToken: 'rk_test_token', createdName: 'CI' } } as any
	});
	expect(body).toContain('Save your API key');
	expect(body).toContain('rk_test_token');
	expect(body).toContain('I saved it');
	expect(body).not.toContain('role="alert"');
});
