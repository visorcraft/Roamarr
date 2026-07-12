import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { getGroupById, deleteGroup, updateGroup } from '$lib/server/repositories/tripsRepo';
import { requireOwnedGroup } from '$lib/server/ownership';
import { logAudit } from '$lib/server/audit';
import { Validator } from '$lib/server/validation';

export const PATCH: RequestHandler = async ({ params, locals, request, getClientAddress }) => {
	const u = requireUser(locals), id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found');
	requireOwnedGroup(u.id, id);
	const limit = checkRateLimit(getClientAddress(), 'api:groups:update');
	if (!limit.allowed) throw error(429, 'Too many requests');
	const body = await request.json() as { name?: unknown }, validator = new Validator();
	const name = validator.requiredString(body.name, 'name', { max: 200 });
	if (!validator.ok()) return json({ error: validator.failMessage() }, { status: 400 });
	updateGroup(id, { name: name! });
	logAudit(u.id, 'group_update', 'group', id);
	return json({ ok: true, id, name });
};

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
