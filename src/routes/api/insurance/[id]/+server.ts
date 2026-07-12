import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { getInsurancePolicyById, deleteInsurancePolicy } from '$lib/server/repositories/profileRepo';
import { logAudit } from '$lib/server/audit';
import { Validator, currency as parseCurrency } from '$lib/server/validation';
import { updatePolicy } from '$lib/server/insurancePolicies';

const parseId = (raw: string | undefined) => { const id = Number(raw); if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found'); return id; };
export const GET: RequestHandler = ({ params, locals }) => { const user = requireUser(locals), policy = getInsurancePolicyById(parseId(params.id), user.id); if (!policy) throw error(404, 'Not found'); return json({ policy }); };
export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	const user = requireUser(locals), id = parseId(params.id), old = getInsurancePolicyById(id, user.id); if (!old) throw error(404, 'Not found'); const body = await request.json() as Record<string, unknown>, validator = new Validator();
	const provider = validator.requiredString(body.provider ?? old.provider, 'provider', { max: 200 }), policyNumber = validator.optionalString(body.policyNumber ?? old.policyNumber, 'policyNumber', { max: 200 }), coverageSummary = validator.optionalString(body.coverageSummary ?? old.coverageSummary, 'coverageSummary', { max: 2000 }), notes = validator.optionalString(body.notes ?? old.notes, 'notes', { max: 2000 });
	const startDate = validator.date(body.startDate ?? old.startDate, 'startDate'), endDate = validator.date(body.endDate ?? old.endDate, 'endDate'); validator.dateRange(startDate, endDate);
	const amount = body.coverageAmount == null || body.coverageAmount === '' ? null : Number(body.coverageAmount); if (amount != null && (!Number.isSafeInteger(amount) || amount < 0)) validator.addError('coverageAmount', 'Coverage amount must be a non-negative integer');
	const currency = parseCurrency(String(body.currency ?? old.currency), 'currency'); if (!currency.ok) validator.addError('currency', currency.error); const tripId = body.tripId == null || body.tripId === '' ? null : validator.positiveId(body.tripId, 'tripId');
	if (!validator.ok()) return json({ error: validator.failMessage(), errors: validator.errors }, { status: 400 });
	const policy = updatePolicy(user.id, id, { provider: provider!, policyNumber, coverageSummary, coverageAmount: amount, currency: currency.ok ? currency.value : 'USD', startDate, endDate, tripId, notes }); logAudit(user.id, 'insurance_policy_update', 'insurance_policy', id); return json({ policy });
};

export const DELETE: RequestHandler = async ({ params, locals, getClientAddress }) => {
	const u = requireUser(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found');

	const limit = checkRateLimit(getClientAddress(), 'api:insurance:delete');
	if (!limit.allowed) throw error(429, 'Too many requests');

	const policy = getInsurancePolicyById(id, u.id);
	if (!policy) throw error(404, 'Not found');

	deleteInsurancePolicy(id, u.id);
	logAudit(u.id, 'insurance_policy_delete', 'insurance_policy', id);
	return new Response(null, { status: 204 });
};
