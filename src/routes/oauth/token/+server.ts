import { json, error } from '@sveltejs/kit';
import { checkRateLimit } from '$lib/server/rateLimit';
import { exchangeAuthorizationCode, refreshAccessToken } from '$lib/server/oauth';
import type { RequestHandler } from '@sveltejs/kit';

// Wire format per RFC 6749 §5.1: snake_case keys. Internal TokenResult stays
// camelCase; only the HTTP boundary is normalized.
function toWire(result: {
	accessToken: string;
	refreshToken: string;
	tokenType: 'Bearer';
	expiresIn: number;
	scope: string;
}) {
	return {
		access_token: result.accessToken,
		refresh_token: result.refreshToken,
		token_type: result.tokenType,
		expires_in: result.expiresIn,
		scope: result.scope
	};
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const limit = checkRateLimit(getClientAddress(), 'oauth_token');
	if (!limit.allowed) throw error(429, 'Too many requests');

	const body = await request.formData();
	const grantType = String(body.get('grant_type') ?? '');

	if (grantType === 'authorization_code') {
		const result = exchangeAuthorizationCode({
			code: String(body.get('code') ?? ''),
			clientId: String(body.get('client_id') ?? ''),
			clientSecret: body.get('client_secret') ? String(body.get('client_secret')) : null,
			codeVerifier: String(body.get('code_verifier') ?? ''),
			redirectUri: body.get('redirect_uri') ? String(body.get('redirect_uri')) : undefined
		});
		if ('error' in result) return json({ error: result.error }, { status: 400 });
		return json(toWire(result));
	}

	if (grantType === 'refresh_token') {
		const result = refreshAccessToken({
			refreshToken: String(body.get('refresh_token') ?? ''),
			clientId: String(body.get('client_id') ?? ''),
			clientSecret: body.get('client_secret') ? String(body.get('client_secret')) : null
		});
		if ('error' in result) return json({ error: result.error }, { status: 400 });
		return json(toWire(result));
	}

	return json({ error: 'unsupported_grant_type' }, { status: 400 });
};
