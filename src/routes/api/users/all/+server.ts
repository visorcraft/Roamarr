import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/auth';
import * as usersRepo from '$lib/server/repositories/usersRepo';

export const GET: RequestHandler = async ({ locals }) => {
	requireAdmin(locals);
	const users = usersRepo.listAllUsers().map((u) => ({
		id: Number(u.id),
		email: u.email,
		displayName: u.display_name ?? ''
	}));
	return json({ users });
};
