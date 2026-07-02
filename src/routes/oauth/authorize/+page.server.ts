import { error, redirect, fail, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import {
	getClient,
	validateScopes,
	createAuthorizationCode,
	ALL_SCOPES,
	isClientAllowed
} from '$lib/server/oauth';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url, getClientAddress }) => {
	const limit = checkRateLimit(getClientAddress(), 'oauth_authorize');
	if (!limit.allowed) throw error(429, 'Too many requests');

	if (!locals.user) {
		throw redirect(302, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	}
	const u = locals.user;

	const responseType = url.searchParams.get('response_type');
	const clientId = url.searchParams.get('client_id') ?? '';
	const redirectUri = url.searchParams.get('redirect_uri') ?? '';
	const scope = url.searchParams.get('scope') ?? '';
	const state = url.searchParams.get('state');
	const codeChallenge = url.searchParams.get('code_challenge') ?? '';
	const codeChallengeMethod = url.searchParams.get('code_challenge_method') ?? '';

	if (responseType !== 'code') throw error(400, 'Only response_type=code is supported');
	if (codeChallengeMethod !== 'S256') throw error(400, 'PKCE with S256 is required');

	const client = getClient(clientId);
	if (!client) throw error(400, 'Unknown client_id');
	if (!isClientAllowed(clientId)) throw error(400, 'client_id is not on the admin allow-list');
	if (!client.redirectUris.includes(redirectUri)) throw error(400, 'redirect_uri mismatch');
	if (!codeChallenge) throw error(400, 'code_challenge is required');

	const requestedScopes = scope.split(/\s+/).filter(Boolean);
	const grantedScopes = validateScopes(requestedScopes, client.scopes.length > 0 ? client.scopes : ALL_SCOPES);

	return {
		client,
		scopes: grantedScopes,
		state,
		redirectUri,
		codeChallenge,
		userEmail: u.email
	};
};

export const actions: Actions = {
	approve: async ({ locals, request, getClientAddress }) => {
		const u = requireUser(locals);
		const limit = checkRateLimit(getClientAddress(), 'oauth_authorize');
		if (!limit.allowed) return fail(429, { error: 'Too many requests' });

		const f = await request.formData();
		const clientId = String(f.get('client_id') ?? '');
		const redirectUri = String(f.get('redirect_uri') ?? '');
		const codeChallenge = String(f.get('code_challenge') ?? '');
		const state = String(f.get('state') ?? '');
		const scopeStr = String(f.get('scopes') ?? '');

		const client = getClient(clientId);
		if (!client) throw error(400, 'Unknown client');
		if (!isClientAllowed(clientId)) throw error(400, 'client_id is not on the admin allow-list');
		// Never trust the posted redirect_uri/scopes: an attacker could tamper the
		// form to exfiltrate the code to an unregistered URL or escalate scopes.
		if (!client.redirectUris.includes(redirectUri)) throw error(400, 'redirect_uri mismatch');

		const requested = scopeStr.split(/\s+/).filter(Boolean);
		const scopes = validateScopes(requested, client.scopes.length > 0 ? client.scopes : ALL_SCOPES);
		const { code, redirectUri: ru } = createAuthorizationCode({
			userId: u.id,
			clientId,
			scopes,
			codeChallenge,
			redirectUri
		});

		const sep = ru.includes('?') ? '&' : '?';
		const location = `${ru}${sep}code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}`;
		throw redirect(302, location);
	},

	deny: async ({ request, getClientAddress }) => {
		const limit = checkRateLimit(getClientAddress(), 'oauth_authorize');
		if (!limit.allowed) return fail(429, { error: 'Too many requests' });

		const f = await request.formData();
		const clientId = String(f.get('client_id') ?? '');
		const redirectUri = String(f.get('redirect_uri') ?? '');
		const state = String(f.get('state') ?? '');
		// Only redirect back to a URI the client actually registered.
		const client = getClient(clientId);
		if (!client || !client.redirectUris.includes(redirectUri)) throw error(400, 'redirect_uri mismatch');
		const sep = redirectUri.includes('?') ? '&' : '?';
		throw redirect(302, `${redirectUri}${sep}error=access_denied${state ? `&state=${encodeURIComponent(state)}` : ''}`);
	}
};
