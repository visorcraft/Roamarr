import { json, error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { verifyRegistration, isPasskeyAvailable, MAX_PASSKEY_NAME_LENGTH } from '$lib/server/passkeys';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	const u = requireUser(locals);
	if (!isPasskeyAvailable()) throw error(400, 'ORIGIN must be set to use passkeys');
	const limit = checkRateLimit(getClientAddress(), 'webauthn_register_verify');
	if (!limit.allowed) throw error(429, 'Too many requests');
	const body = (await request.json().catch(() => null)) as { response?: unknown; name?: unknown } | null;
	if (!body?.response) throw error(400, 'Missing registration response');
	const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_PASSKEY_NAME_LENGTH) : '';
	const result = await verifyRegistration(u.id, body.response, name);
	if (!result.ok) throw error(400, result.error);
	return json({ ok: true });
};
