import { json, error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { verifyRegistration } from '$lib/server/passkeys';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	const u = requireUser(locals);
	const body = (await request.json().catch(() => null)) as { response?: unknown; name?: unknown } | null;
	if (!body?.response) throw error(400, 'Missing registration response');
	const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
	const result = await verifyRegistration(u.id, body.response, name);
	if (!result.ok) throw error(400, result.error);
	return json({ ok: true });
};
