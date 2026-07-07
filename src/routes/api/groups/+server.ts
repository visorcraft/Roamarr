import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTableParams } from '$lib/tableParams';
import { requireUser } from '$lib/server/auth';
import {
	listGroupsForUserPaginated,
	countGroupsForUser,
	countMembersForGroupIds
} from '$lib/server/repositories/tripsRepo';
import { checkRateLimit } from '$lib/server/rateLimit';

export const GET: RequestHandler = async ({ url, locals, getClientAddress }) => {
	const u = requireUser(locals);

	const limit = checkRateLimit(getClientAddress(), 'api:groups:list');
	if (!limit.allowed) {
		return json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
	}

	const { page, limit: pageSize, search, sort, dir } = parseTableParams(url, ['name', 'createdAt']);
	const offset = (page - 1) * pageSize;
	const groups = listGroupsForUserPaginated(u.id, {
		search,
		sortBy: sort as 'name' | 'createdAt' | undefined,
		sortDir: dir,
		limit: pageSize,
		offset,
		ownedOnly: true
	});
	const memberCounts = countMembersForGroupIds(groups.map((g) => g.id));
	const rows = groups.map((g) => ({
		id: g.id,
		name: g.name,
		createdAt: g.createdAt,
		memberCount: memberCounts.get(g.id) ?? 0
	}));
	const total = countGroupsForUser(u.id, search, true);
	return json({ rows, total });
};
