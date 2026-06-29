import { json, error } from '@sveltejs/kit';
import { verifyAuth, isPasskeyAvailable } from '$lib/server/passkeys';
import { createSession, sessionCookieOptions } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

// Public (pre-login): verifies a passkey assertion and, on success, issues a
// session directly. A passkey is a primary credential and satisfies auth on its
// own — no TOTP step-up (PLAN resolved decision).
export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	if (!isPasskeyAvailable()) throw error(400, 'ORIGIN must be set to use passkeys');
	const limit = checkRateLimit(getClientAddress(), 'webauthn_auth');
	if (!limit.allowed) throw error(429, 'Too many requests');

	const body = await request.json().catch(() => null);
	if (!body) throw error(400, 'Missing assertion');

	const result = await verifyAuth(body);
	if (!result.ok) throw error(401, result.error);

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') ?? undefined;
	cookies.set('session', createSession(result.userId, ip, ua), sessionCookieOptions());
	return json({ ok: true });
};
