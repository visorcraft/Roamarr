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
import { Validator, currency as parseCurrency } from '$lib/server/validation';
import { addPolicy } from '$lib/server/insurancePolicies';
import { logAudit } from '$lib/server/audit';

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

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals), body = await request.json() as Record<string, unknown>, validator = new Validator();
	const provider = validator.requiredString(body.provider, 'provider', { max: 200 }), policyNumber = validator.optionalString(body.policyNumber, 'policyNumber', { max: 200 });
	const coverageSummary = validator.optionalString(body.coverageSummary, 'coverageSummary', { max: 2000 }), notes = validator.optionalString(body.notes, 'notes', { max: 2000 });
	const startDate = validator.date(body.startDate, 'startDate'), endDate = validator.date(body.endDate, 'endDate'); validator.dateRange(startDate, endDate);
	const amount = body.coverageAmount == null || body.coverageAmount === '' ? undefined : Number(body.coverageAmount); if (amount != null && (!Number.isSafeInteger(amount) || amount < 0)) validator.addError('coverageAmount', 'Coverage amount must be a non-negative integer');
	const currency = parseCurrency(String(body.currency ?? 'USD'), 'currency'); if (!currency.ok) validator.addError('currency', currency.error);
	const tripId = body.tripId == null || body.tripId === '' ? undefined : validator.positiveId(body.tripId, 'tripId');
	if (!validator.ok()) return json({ error: validator.failMessage(), errors: validator.errors }, { status: 400 });
	const policy = addPolicy(user.id, { provider: provider!, policyNumber, coverageSummary, coverageAmount: amount, currency: currency.ok ? currency.value : 'USD', startDate, endDate, tripId, notes });
	logAudit(user.id, 'insurance_policy_create', 'insurance_policy', policy.id); return json({ policy }, { status: 201 });
};
