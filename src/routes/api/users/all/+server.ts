import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import * as usersRepo from '$lib/server/repositories/usersRepo';

export const GET: RequestHandler = async ({ locals, getClientAddress }) => {
	requireAdmin(locals);
	const limit = checkRateLimit(getClientAddress(), 'api:users:all');
	if (!limit.allowed) {
		throw error(429, `Rate limited. Try again in ${limit.retryAfter ?? 1} seconds.`);
	}

	const users = usersRepo.listAllUsers().map((u) => ({
		id: Number(u.id),
		email: u.email,
		displayName: u.display_name ?? ''
	}));
	return json({ users });
};
