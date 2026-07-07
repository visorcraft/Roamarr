import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTableParams } from '$lib/tableParams';
import { requireUser } from '$lib/server/auth';
import {
	listGroupsForUserPaginated,
	countGroupsForUser,
	countMembersForGroupIds
} from '$lib/server/repositories/tripsRepo';

export const GET: RequestHandler = async ({ url, locals }) => {
	const u = requireUser(locals);
	const { page, limit, search, sort, dir } = parseTableParams(url, ['name', 'createdAt']);
	const offset = (page - 1) * limit;
	const groups = listGroupsForUserPaginated(u.id, {
		search,
		sortBy: sort as 'name' | 'createdAt' | undefined,
		sortDir: dir,
		limit,
		offset
	});
	const memberCounts = countMembersForGroupIds(groups.map((g) => g.id));
	const rows = groups.map((g) => ({
		id: g.id,
		name: g.name,
		createdAt: g.createdAt,
		memberCount: memberCounts.get(g.id) ?? 0
	}));
	const total = countGroupsForUser(u.id, search);
	return json({ rows, total });
};
