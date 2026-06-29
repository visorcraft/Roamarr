import { describe, test, expect } from 'vitest';
import { GET } from './+server';
import { appInfo } from '$lib/appInfo';

describe('.well-known/mcp.json', () => {
	test('returns MCP server metadata with OAuth linkage', async () => {
		const res = await GET({ url: new URL('https://roamarr.example.com/.well-known/mcp.json') } as any);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.name).toContain(appInfo.name);
		expect(body.version).toBe(appInfo.version);
		expect(body.endpoint).toBe('https://roamarr.example.com/mcp');
		expect(body.authentication.type).toBe('oauth2');
		expect(body.authentication.oauth_authorization_server).toBe(
			'https://roamarr.example.com/.well-known/oauth-authorization-server'
		);
		expect(body.capabilities.tools).toEqual({});
		expect(body.scopes_supported).toContain('trips:read');
		expect(body.scopes_supported).toContain('trips:write');
	});
});
