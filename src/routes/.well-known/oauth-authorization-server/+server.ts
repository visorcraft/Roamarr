import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = ({ url }) => {
	const origin = url.origin;
	return json({
		issuer: origin,
		authorization_endpoint: `${origin}/oauth/authorize`,
		token_endpoint: `${origin}/oauth/token`,
		revocation_endpoint: `${origin}/oauth/revoke`,
		mcp_endpoint: `${origin}/mcp`,
		mcp_metadata_endpoint: `${origin}/.well-known/mcp.json`,
		scopes_supported: [
			'trips:read',
			'trips:write',
			'packing:write',
			'budgets:write',
			'places:read',
			'places:write',
			'reminders:write',
			'profile:read'
		],
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['client_secret_post', 'none']
	});
};
