import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { adminDeleteUser } from '$lib/server/users';

export const DELETE: RequestHandler = async ({ params, locals, getClientAddress }) => {
	const admin = requireAdmin(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) throw error(400, 'Invalid user.');

	const limit = checkRateLimit(getClientAddress(), 'api:users:delete');
	if (!limit.allowed) {
		throw error(429, `Rate limited. Try again in ${limit.retryAfter ?? 1} seconds.`);
	}

	try {
		await adminDeleteUser(admin.id, id);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Could not delete user.');
	}

	return new Response(null, { status: 204 });
};
