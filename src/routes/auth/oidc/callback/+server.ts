import { error, redirect, type Cookies } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSession, sessionCookieOptions } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { setFlash } from '$lib/server/flash';
import { createPendingCookie, isTwoFactorEnabled } from '$lib/server/twoFactor';
import {
	exchangeCode,
	fetchDiscovery,
	fetchJwks,
	getOidcConfig,
	oidcRedirectUri,
	resolveOrigin,
	resolveOidcUser,
	verifyIdToken,
	verifyOidcFlowCookie
} from '$lib/server/oidc';

/** Soft failures (provider down, provider denied, unknown user) return to the login page with a flash. */
function failWithFlash(cookies: Cookies, message: string): never {
	setFlash(cookies, { message, variant: 'error' });
	throw redirect(303, '/login');
}

export const GET: RequestHandler = async ({ request, cookies, getClientAddress, url }) => {
	const limit = checkRateLimit(getClientAddress(), 'oidc_callback');
	if (!limit.allowed) throw error(429, 'Too many requests');

	// Read the flow cookie first; cookies.delete would hide it from cookies.get.
	const flowCookie = cookies.get('oidc_flow');
	cookies.delete('oidc_flow', { path: '/' });

	const config = getOidcConfig();
	if (!config) failWithFlash(cookies, 'SSO sign-in is not configured.');

	if (url.searchParams.get('error')) {
		failWithFlash(cookies, 'The identity provider denied the sign-in request.');
	}

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const flow = verifyOidcFlowCookie(flowCookie);
	// State/nonce/PKCE material is missing, expired, forged, or does not match
	// the redirect: reject outright rather than starting a new flow.
	if (!code || !state || !flow || flow.state !== state) {
		throw error(400, 'Invalid or expired SSO sign-in state.');
	}

	let discovery;
	try {
		discovery = await fetchDiscovery(config.discoveryUrl);
	} catch {
		failWithFlash(cookies, 'SSO sign-in is temporarily unavailable.');
	}

	const redirectUri = oidcRedirectUri(resolveOrigin(url.origin));
	let idToken: string;
	try {
		idToken = await exchangeCode(discovery, config, code, redirectUri, flow.codeVerifier);
	} catch {
		failWithFlash(cookies, 'SSO sign-in failed while contacting the identity provider.');
	}

	let jwks;
	try {
		jwks = await fetchJwks(discovery.jwksUri);
	} catch {
		failWithFlash(cookies, 'SSO sign-in is temporarily unavailable.');
	}

	let claims;
	try {
		claims = verifyIdToken(idToken!, {
			issuer: discovery.issuer,
			clientId: config.clientId,
			nonce: flow.nonce,
			jwks
		});
	} catch {
		throw error(400, 'The identity provider returned an invalid identity token.');
	}

	const resolution = await resolveOidcUser(claims);
	if (!resolution.ok) failWithFlash(cookies, resolution.error);

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') ?? undefined;
	const next = flow.next;

	// TOTP is honored, not bypassed: users with 2FA enabled complete the
	// existing challenge flow before a session is created.
	if (isTwoFactorEnabled(resolution.userId)) {
		const pending = createPendingCookie(resolution.userId, ip, ua);
		cookies.set('tfa_pending', pending.value, {
			...sessionCookieOptions(),
			maxAge: pending.maxAge
		});
		throw redirect(303, next ? `/login/verify?next=${encodeURIComponent(next)}` : '/login/verify');
	}

	cookies.set('session', createSession(resolution.userId, ip, ua), sessionCookieOptions());
	throw redirect(303, next ?? '/');
};
