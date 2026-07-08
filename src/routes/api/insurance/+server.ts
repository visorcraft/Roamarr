import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTableParams } from '$lib/tableParams';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import {
	listInsurancePoliciesPaginated,
	countInsurancePolicies
} from '$lib/server/repositories/profileRepo';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';

export const GET: RequestHandler = async ({ url, locals, getClientAddress }) => {
	const u = requireUser(locals);
	const limit = checkRateLimit(getClientAddress(), 'api:insurance:list');
	if (!limit.allowed) throw error(429, 'Too many requests');
	const { page, limit: pageLimit, search, sort, dir, from, to } = parseTableParams(url, [
		'provider',
		'policyNumber',
		'startDate',
		'endDate'
	]);
	const offset = (page - 1) * pageLimit;
	const policies = listInsurancePoliciesPaginated(u.id, {
		search,
		sortBy: sort as 'provider' | 'policyNumber' | 'startDate' | 'endDate' | undefined,
		sortDir: dir,
		from,
		to,
		limit: pageLimit,
		offset
	});
	const trips = tripsRepo.listTripsForUser(u.id);
	const tripName = new Map<number, string>(trips.map((t) => [t.id, t.name]));
	const rows = policies.map((p) => ({
		id: p.id,
		provider: p.provider,
		policyNumber: p.policyNumber,
		coverageSummary: p.coverageSummary,
		coverageAmount: p.coverageAmount,
		currency: p.currency,
		startDate: p.startDate,
		endDate: p.endDate,
		tripId: p.tripId,
		tripName: p.tripId != null ? tripName.get(p.tripId) ?? null : null
	}));
	const total = countInsurancePolicies(u.id, search, from, to);
	return json({ rows, total });
};
