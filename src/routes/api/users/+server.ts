import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTableParams } from '$lib/tableParams';
import { requireAdmin } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { areTwoFactorEnabledForUserIds } from '$lib/server/twoFactor';

export const GET: RequestHandler = async ({ url, locals, getClientAddress }) => {
	requireAdmin(locals);
	const limit = checkRateLimit(getClientAddress(), 'api:users:list');
	if (!limit.allowed) throw error(429, 'Too many requests');
	const { page, limit: pageSize, search, sort, dir } = parseTableParams(url, [
		'email',
		'displayName',
		'role',
		'createdAt'
	]);
	const offset = (page - 1) * pageSize;
	const users = usersRepo.listUsers({
		search,
		sortBy: sort as 'email' | 'displayName' | 'role' | 'createdAt' | undefined,
		sortDir: dir,
		limit: pageSize,
		offset
	});
	const twoFactorEnabled = areTwoFactorEnabledForUserIds(users.map((u) => Number(u.id)));
	const rows = users.map((u) => ({
		id: Number(u.id),
		email: u.email,
		displayName: u.display_name ?? '',
		role: u.role,
		disabled: u.disabled,
		mustResetPassword: u.must_reset_password,
		createdAt: u.created_at,
		twoFactorEnabled: twoFactorEnabled.has(Number(u.id))
	}));
	const total = usersRepo.countUsers(search);
	return json({ rows, total });
};
