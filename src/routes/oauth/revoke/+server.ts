import { json, error } from '@sveltejs/kit';
import { checkRateLimit } from '$lib/server/rateLimit';
import { revokeTokenForUser, verifyAccessToken } from '$lib/server/oauth';
import { logAudit } from '$lib/server/audit';
import type { RequestHandler } from '@sveltejs/kit';

function extractBearer(request: Request): string | null {
	const auth = request.headers.get('authorization') ?? '';
	if (!auth.startsWith('Bearer ')) return null;
	return auth.slice(7);
}

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	const limit = checkRateLimit(getClientAddress(), 'oauth_revoke');
	if (!limit.allowed) throw error(429, 'Too many requests');

	let actingUserId: number | undefined;

	// Prefer an authenticated session, but accept a Bearer token as well.
	if (locals.user) {
		actingUserId = locals.user.id;
	} else {
		const bearer = extractBearer(request);
		if (!bearer) return json({ error: 'Authentication required' }, { status: 401 });
		const auth = verifyAccessToken(bearer);
		if (!auth) return json({ error: 'Invalid or expired token' }, { status: 401 });
		actingUserId = auth.userId;
	}

	const body = await request.formData();
	const token = String(body.get('token') ?? '');
	if (!token) return json({ error: 'token is required' }, { status: 400 });

	const revoked = revokeTokenForUser(actingUserId, token);
	if (!revoked) return json({ error: 'Token not found or not owned by caller' }, { status: 400 });

	logAudit(actingUserId, 'oauth_token_revoke', 'oauth_token', 0, {});
	return json({});
};
