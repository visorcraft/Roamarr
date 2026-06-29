import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { appInfo } from '$lib/appInfo';

export const GET: RequestHandler = ({ url }) => {
	const origin = url.origin;
	return json({
		name: `${appInfo.name} MCP`,
		version: appInfo.version,
		protocol_version: '2024-11-05',
		endpoint: `${origin}/mcp`,
		authentication: {
			type: 'oauth2',
			oauth_authorization_server: `${origin}/.well-known/oauth-authorization-server`
		},
		capabilities: {
			tools: {},
			prompts: {},
			resources: {}
		},
		scopes_supported: [
			'trips:read',
			'trips:write',
			'packing:write',
			'budgets:write',
			'places:read',
			'places:write',
			'reminders:write',
			'profile:read'
		]
	});
};
