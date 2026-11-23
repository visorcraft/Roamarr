import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import AuthorizePage from './+page.svelte';
import { SCOPE_DESCRIPTIONS } from '$lib/oauthScopes';

test('renders every requested scope with theme-driven text', () => {
	const scopes = Object.keys(SCOPE_DESCRIPTIONS).slice(0, 2);
	const { body } = render(AuthorizePage, {
		props: {
			data: {
				client: { clientName: 'Trip Bot', clientId: 'client_1' },
				userEmail: 'user@example.com',
				redirectUri: 'https://app.example.com/callback',
				state: 'st4te',
				codeChallenge: 'chal',
				scopes,
				privateDetailsRequested: true
			}
		} as any
	});
	expect(body).toContain('<p class="text-sm font-medium text-[var(--theme-ink)]">This will allow the application to:</p>');
	expect(body).toContain('<li class="flex items-start gap-2 text-sm text-[var(--theme-readable-muted)]">');
	expect(body).toContain('<span class="mt-0.5 text-[var(--theme-readable-muted)]" aria-hidden="true">');
	for (const scope of scopes) {
		expect(body).toContain(SCOPE_DESCRIPTIONS[scope as keyof typeof SCOPE_DESCRIPTIONS]);
	}
	expect(body).toContain('Share private travel details');
	expect(body).toContain('action="?/deny"');
	expect(body).toContain('action="?/approve"');
});

test('uses no fixed palette utilities inside the themed card', () => {
	const scopes = Object.keys(SCOPE_DESCRIPTIONS).slice(0, 2);
	const { body } = render(AuthorizePage, {
		props: {
			data: {
				client: { clientName: 'Trip Bot', clientId: 'client_1' },
				userEmail: 'user@example.com',
				redirectUri: 'https://app.example.com/callback',
				state: 'st4te',
				codeChallenge: 'chal',
				scopes,
				privateDetailsRequested: true
			}
		} as any
	});
	expect(body).not.toMatch(/\b(?:text|bg|border|ring)-(?:white|slate-\d{2,3}|indigo-\d{2,3}|gray-\d{2,3})\b/);
});
