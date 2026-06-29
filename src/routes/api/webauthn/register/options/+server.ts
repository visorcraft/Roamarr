import { json, error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { createRegistrationOptions } from '$lib/server/passkeys';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

// Authenticated: only a signed-in user can enroll a passkey on their own account.
export const POST: RequestHandler = async ({ locals, getClientAddress }) => {
	const u = requireUser(locals);
	const limit = checkRateLimit(getClientAddress(), 'webauthn_register_options');
	if (!limit.allowed) throw error(429, 'Too many requests');
	try {
		return json(await createRegistrationOptions(u.id, u.email));
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Could not start registration');
	}
};
