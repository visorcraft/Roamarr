import { json, error } from '@sveltejs/kit';
import { checkRateLimit } from '$lib/server/rateLimit';
import { verifyAuth, isPasskeyAvailable } from '$lib/server/passkeys';
import { createSession, sessionCookieOptions } from '$lib/server/auth';
import type { RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	if (!isPasskeyAvailable()) throw error(400, 'ORIGIN must be set to use passkeys');
	const limit = checkRateLimit(getClientAddress(), 'passkey');
	if (!limit.allowed) throw error(429, 'Too many attempts');

	const body = await request.json();
	const result = await verifyAuth(body);
	if (!result.ok) throw error(401, result.error);

	const token = createSession(result.userId, getClientAddress(), request.headers.get('user-agent') ?? undefined);
	cookies.set('session', token, sessionCookieOptions());
	return json({ ok: true });
};
