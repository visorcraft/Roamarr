import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { deleteProvider } from '$lib/server/fareproviders';
import { logAudit } from '$lib/server/audit';

export const DELETE: RequestHandler = async ({ params, locals, getClientAddress }) => {
	const admin = requireAdmin(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(400, 'Invalid id');
	const limit = checkRateLimit(getClientAddress(), 'api:fare-providers:delete');
	if (!limit.allowed) throw error(429, 'Too many requests');
	deleteProvider(admin.id, id);
	logAudit(admin.id, 'fare_provider_delete', 'fare_provider', id);
	return new Response(null, { status: 204 });
};
