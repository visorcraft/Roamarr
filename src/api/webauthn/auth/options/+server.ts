import { json, error } from '@sveltejs/kit';
import { checkRateLimit } from '$lib/server/rateLimit';
import { createAuthOptions, isPasskeyAvailable } from '$lib/server/passkeys';
import type { RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ getClientAddress }) => {
	if (!isPasskeyAvailable()) throw error(400, 'ORIGIN must be set to use passkeys');
	const limit = checkRateLimit(getClientAddress(), 'passkey');
	if (!limit.allowed) throw error(429, 'Too many attempts');
	try {
		const options = await createAuthOptions();
		return json(options);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Failed to generate auth options');
	}
};
