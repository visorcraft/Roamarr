import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkRateLimit } from '$lib/server/rateLimit';
import { setFlash } from '$lib/server/flash';
import {
	buildAuthorizationUrl,
	createOidcFlow,
	fetchDiscovery,
	getOidcConfig,
	oidcFlowCookieOptions,
	oidcRedirectUri,
	resolveOrigin
} from '$lib/server/oidc';

function ssoUnavailable(cookies: Parameters<typeof setFlash>[0], message: string): never {
	setFlash(cookies, { message, variant: 'error' });
	throw redirect(303, '/login');
}

export const GET: RequestHandler = async ({ cookies, getClientAddress, url }) => {
	const limit = checkRateLimit(getClientAddress(), 'oidc_start');
	if (!limit.allowed) throw error(429, 'Too many requests');

	const config = getOidcConfig();
	if (!config) ssoUnavailable(cookies, 'SSO sign-in is not configured.');

	let discovery;
	try {
		discovery = await fetchDiscovery(config.discoveryUrl);
	} catch {
		ssoUnavailable(cookies, 'SSO sign-in is temporarily unavailable.');
	}

	// Optional post-login target; only same-origin relative paths (same rule
	// as the password login form).
	const rawNext = url.searchParams.get('next');
	const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null;

	const flow = createOidcFlow(next);
	cookies.set('oidc_flow', flow.cookieValue, oidcFlowCookieOptions());

	const redirectUri = oidcRedirectUri(resolveOrigin(url.origin));
	throw redirect(302, buildAuthorizationUrl(discovery, config, flow, redirectUri));
};
