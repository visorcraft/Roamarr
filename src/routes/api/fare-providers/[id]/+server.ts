import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { deleteProvider, updateProvider } from '$lib/server/fareproviders';
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

export const PATCH: RequestHandler = async ({ params, request, locals, getClientAddress }) => {
	const admin = requireAdmin(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(400, 'Invalid id');
	const limit = checkRateLimit(getClientAddress(), 'fare-providers:update');
	if (!limit.allowed) throw error(429, 'Too many requests');
	const body = await request.json().catch(() => { throw error(400, 'Invalid JSON'); });
	if (body === null || typeof body !== 'object' || Array.isArray(body)) throw error(400, 'Invalid JSON');
	const { label, apiKey, enabled } = body as Record<string, unknown>;
	if (label !== undefined && typeof label !== 'string') throw error(400, 'label must be a string');
	if (apiKey !== undefined && apiKey !== null && typeof apiKey !== 'string') throw error(400, 'apiKey must be a string');
	if (enabled !== undefined && typeof enabled !== 'boolean') throw error(400, 'enabled must be a boolean');
	try {
		updateProvider(admin.id, id, label ?? null, apiKey ?? '', enabled);
	} catch (e) {
		if (e instanceof Error && e.message.includes('Label is required')) throw error(400, e.message);
		throw e;
	}
	logAudit(admin.id, 'fare_provider_update', 'fare_provider', id);
	return new Response(null, { status: 204 });
};
