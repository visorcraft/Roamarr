import { json, error } from '@sveltejs/kit';
import { createAuthOptions, isPasskeyAvailable } from '$lib/server/passkeys';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

// Public (pre-login): hands out a discoverable-credential assertion challenge.
export const POST: RequestHandler = async ({ getClientAddress }) => {
	if (!isPasskeyAvailable()) throw error(400, 'Passkeys are not configured');
	const limit = checkRateLimit(getClientAddress(), 'webauthn_auth');
	if (!limit.allowed) throw error(429, 'Too many requests');
	try {
		return json(await createAuthOptions());
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Could not start authentication');
	}
};
