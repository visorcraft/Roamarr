import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { testProvider } from '$lib/server/fareproviders';

export const POST: RequestHandler = async ({ params, locals, getClientAddress }) => {
	const admin = requireAdmin(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(400, 'Invalid id');
	const limit = checkRateLimit(getClientAddress(), 'api:fare-providers:test');
	if (!limit.allowed) throw error(429, 'Too many requests');
	const { ok, summary } = await testProvider(admin.id, id);
	return json({ ok, summary });
};
