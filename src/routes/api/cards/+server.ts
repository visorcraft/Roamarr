import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTableParams } from '$lib/tableParams';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { listCardsPaginated, countCards, listBenefitsForCards, createCard } from '$lib/server/repositories/profileRepo';
import { logAudit } from '$lib/server/audit';
import { Validator, sanitizeLast4 } from '$lib/server/validation';

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

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireUser(locals), body = await request.json() as Record<string, unknown>, validator = new Validator();
	const nickname = validator.requiredString(body.nickname, 'nickname', { max: 200 });
	const network = validator.enumValue(body.network, ['visa', 'mc', 'amex', 'disc', 'other'] as const, 'network');
	const last4 = validator.optionalString(body.last4, 'last4', { max: 4 }), notes = validator.optionalString(body.notes, 'notes', { max: 2000 });
	if (last4 && !/^\d{4}$/.test(last4)) validator.addError('last4', 'last4 must be exactly 4 digits');
	if (!validator.ok()) return json({ error: validator.failMessage(), errors: validator.errors }, { status: 400 });
	const card = createCard(user.id, { nickname: nickname!, network: network!, last4: sanitizeLast4(last4), notes });
	logAudit(user.id, 'card_create', 'card', card.id);
	return json({ card }, { status: 201 });
};
