import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTableParams } from '$lib/tableParams';
import { requireAdmin } from '$lib/server/auth';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { isTwoFactorEnabled } from '$lib/server/twoFactor';

export const GET: RequestHandler = ({ url, locals }) => {
	requireAdmin(locals);
	const { page, limit, search, sort, dir } = parseTableParams(url, [
		'email',
		'displayName',
		'role',
		'createdAt'
	]);
	const offset = (page - 1) * limit;
	const users = usersRepo.listUsers({
		search,
		sortBy: sort as 'email' | 'displayName' | 'role' | 'createdAt' | undefined,
		sortDir: dir,
		limit,
		offset
	});
	const rows = users.map((u) => ({
		id: Number(u.id),
		email: u.email,
		displayName: u.display_name ?? '',
		role: u.role,
		disabled: u.disabled,
		mustResetPassword: u.must_reset_password,
		createdAt: u.created_at,
		twoFactorEnabled: isTwoFactorEnabled(Number(u.id))
	}));
	const total = usersRepo.countUsers(search);
	return json({ rows, total });
};
