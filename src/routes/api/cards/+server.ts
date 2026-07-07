import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTableParams } from '$lib/tableParams';
import { requireUser } from '$lib/server/auth';
import { listCardsPaginated, countCards } from '$lib/server/repositories/profileRepo';

export const GET: RequestHandler = ({ url, locals }) => {
	const u = requireUser(locals);
	const { page, limit, search, sort, dir } = parseTableParams(url, ['nickname', 'network', 'last4']);
	const offset = (page - 1) * limit;
	const cards = listCardsPaginated(u.id, {
		search,
		sortBy: sort as 'nickname' | 'network' | 'last4' | undefined,
		sortDir: dir,
		limit,
		offset
	});
	const rows = cards.map((c) => ({
		id: c.id,
		nickname: c.nickname,
		network: c.network,
		last4: c.last4,
		notes: c.notes
	}));
	const total = countCards(u.id, search);
	return json({ rows, total });
};
