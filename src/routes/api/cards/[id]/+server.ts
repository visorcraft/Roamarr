import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { getCardById, deleteCard } from '$lib/server/repositories/profileRepo';
import { logAudit } from '$lib/server/audit';

export const DELETE: RequestHandler = async ({ params, locals, getClientAddress }) => {
	const u = requireUser(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found');

	const limit = checkRateLimit(getClientAddress(), 'api:cards:delete');
	if (!limit.allowed) throw error(429, 'Too many requests');

	const card = getCardById(id, u.id);
	if (!card) throw error(404, 'Not found');

	deleteCard(id, u.id);
	logAudit(u.id, 'card_delete', 'card', id);
	return new Response(null, { status: 204 });
};
