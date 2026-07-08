import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { getLoyaltyProgramById, deleteLoyaltyProgram } from '$lib/server/repositories/profileRepo';
import { logAudit } from '$lib/server/audit';

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
