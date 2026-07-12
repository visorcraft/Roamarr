import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { getLoyaltyProgramById, deleteLoyaltyProgram, updateLoyaltyProgram } from '$lib/server/repositories/profileRepo';
import { logAudit } from '$lib/server/audit';
import { Validator } from '$lib/server/validation';

const parseId = (raw: string | undefined) => { const id = Number(raw); if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found'); return id; };
export const GET: RequestHandler = ({ params, locals }) => { const user = requireUser(locals), program = getLoyaltyProgramById(parseId(params.id), user.id); if (!program) throw error(404, 'Not found'); return json({ program }); };
export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	const user = requireUser(locals), id = parseId(params.id), existing = getLoyaltyProgramById(id, user.id); if (!existing) throw error(404, 'Not found');
	const body = await request.json() as Record<string, unknown>, validator = new Validator(), programName = validator.requiredString(body.programName ?? existing.programName, 'programName', { max: 200 });
	const membershipNumber = validator.optionalString(body.membershipNumber ?? existing.membershipNumber, 'membershipNumber', { max: 200 }), notes = validator.optionalString(body.notes ?? existing.notes, 'notes', { max: 2000 });
	const balance = body.balance == null || body.balance === '' ? null : Number(body.balance); if (balance != null && (!Number.isFinite(balance) || balance < 0)) validator.addError('balance', 'Balance must be non-negative');
	if (!validator.ok()) return json({ error: validator.failMessage(), errors: validator.errors }, { status: 400 });
	const program = updateLoyaltyProgram(id, user.id, { programName: programName!, membershipNumber, balance, notes }); logAudit(user.id, 'loyalty_program_update', 'loyalty_program', id); return json({ program });
};

export const DELETE: RequestHandler = async ({ params, locals, getClientAddress }) => {
	const u = requireUser(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found');

	const limit = checkRateLimit(getClientAddress(), 'api:loyalty:delete');
	if (!limit.allowed) throw error(429, 'Too many requests');

	const program = getLoyaltyProgramById(id, u.id);
	if (!program) throw error(404, 'Not found');

	deleteLoyaltyProgram(id, u.id);
	logAudit(u.id, 'loyalty_program_delete', 'loyalty_program', id);
	return new Response(null, { status: 204 });
};
