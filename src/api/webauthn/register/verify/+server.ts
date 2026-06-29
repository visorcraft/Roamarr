import { json, error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { verifyRegistration, isPasskeyAvailable } from '$lib/server/passkeys';
import type { RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ locals, request }) => {
	const u = requireUser(locals);
	if (!isPasskeyAvailable()) throw error(400, 'ORIGIN must be set to use passkeys');
	const body = await request.json();
	const name = String(body.name ?? '');
	const result = await verifyRegistration(u.id, body.response ?? body, name);
	if (!result.ok) throw error(400, result.error);
	return json({ ok: true });
};
