import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { getGroupById, deleteGroup } from '$lib/server/repositories/tripsRepo';
import { requireOwnedGroup } from '$lib/server/ownership';
import { logAudit } from '$lib/server/audit';

export const DELETE: RequestHandler = async ({ params, locals, getClientAddress }) => {
	const u = requireUser(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found');

	const limit = checkRateLimit(getClientAddress(), 'api:groups:delete');
	if (!limit.allowed) throw error(429, 'Too many requests');

	const group = getGroupById(id);
	if (!group) throw error(404, 'Not found');

	requireOwnedGroup(u.id, id);
	deleteGroup(id);
	logAudit(u.id, 'group_delete', 'group', id);
	return new Response(null, { status: 204 });
};
