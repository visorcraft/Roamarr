import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTableParams } from '$lib/tableParams';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import {
	listLoyaltyProgramsPaginated,
	countLoyaltyPrograms
} from '$lib/server/repositories/profileRepo';

export const GET: RequestHandler = async ({ url, locals, getClientAddress }) => {
	const u = requireUser(locals);
	const limit = checkRateLimit(getClientAddress(), 'api:loyalty:list');
	if (!limit.allowed) throw error(429, 'Too many requests');
	const { page, limit: pageLimit, search, sort, dir } = parseTableParams(url, [
		'programName',
		'membershipNumber',
		'balance',
		'balanceUpdatedAt'
	]);
	const offset = (page - 1) * pageLimit;
	const rows = listLoyaltyProgramsPaginated(u.id, {
		search,
		sortBy: sort as 'programName' | 'membershipNumber' | 'balance' | 'balanceUpdatedAt' | undefined,
		sortDir: dir,
		limit: pageLimit,
		offset
	});
	const total = countLoyaltyPrograms(u.id, search);
	return json({
		rows: rows.map((p) => ({
			id: p.id,
			programName: p.programName,
			membershipNumber: p.membershipNumber,
			balance: p.balance,
			notes: p.notes,
			balanceUpdatedAt: p.balanceUpdatedAt
		})),
		total
	});
};
