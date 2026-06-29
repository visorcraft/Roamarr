import { json, error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { createRegistrationOptions } from '$lib/server/passkeys';
import type { RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ locals }) => {
	const u = requireUser(locals);
	try {
		const options = await createRegistrationOptions(u.id, u.email);
		return json(options);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Failed to generate registration options');
	}
};
