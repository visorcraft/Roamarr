import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTableParams } from '$lib/tableParams';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { listCardsPaginated, countCards, listBenefitsForCards } from '$lib/server/repositories/profileRepo';

export const GET: RequestHandler = async ({ url, locals, getClientAddress }) => {
	const u = requireUser(locals);
	const limit = checkRateLimit(getClientAddress(), 'api:cards:list');
	if (!limit.allowed) throw error(429, 'Too many requests');
	const { page, limit: pageLimit, search, sort, dir } = parseTableParams(url, ['nickname', 'network', 'last4']);
	const offset = (page - 1) * pageLimit;
	const cards = listCardsPaginated(u.id, {
		search,
		sortBy: sort as 'nickname' | 'network' | 'last4' | undefined,
		sortDir: dir,
		limit: pageLimit,
		offset
	});
	const cardIds = cards.map((c) => c.id);
	const allBenefits = listBenefitsForCards(cardIds);
	const benefitCountByCard = new Map<number, number>();
	for (const b of allBenefits) {
		benefitCountByCard.set(b.cardId, (benefitCountByCard.get(b.cardId) ?? 0) + 1);
	}
	const rows = cards.map((c) => ({
		id: c.id,
		nickname: c.nickname,
		network: c.network,
		last4: c.last4,
		benefitCount: benefitCountByCard.get(c.id) ?? 0
	}));
	const total = countCards(u.id, search);
	return json({ rows, total });
};
