import { json, error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { createRegistrationOptions } from '$lib/server/passkeys';
import type { RequestHandler } from './$types';

// Authenticated: only a signed-in user can enroll a passkey on their own account.
export const POST: RequestHandler = async ({ locals }) => {
	const u = requireUser(locals);
	try {
		return json(await createRegistrationOptions(u.id, u.email));
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Could not start registration');
	}
};
