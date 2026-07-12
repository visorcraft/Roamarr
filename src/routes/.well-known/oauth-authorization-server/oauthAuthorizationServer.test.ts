import { describe, test, expect } from 'vitest';
import { GET } from './+server';

describe('.well-known/oauth-authorization-server', () => {
	test('exposes OAuth endpoints and links MCP metadata', async () => {
		const res = await GET({ url: new URL('https://roamarr.example.com/.well-known/oauth-authorization-server') } as any);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.issuer).toBe('https://roamarr.example.com');
		expect(body.authorization_endpoint).toBe('https://roamarr.example.com/oauth/authorize');
		expect(body.token_endpoint).toBe('https://roamarr.example.com/oauth/token');
		expect(body.registration_endpoint).toBe('https://roamarr.example.com/oauth/register');
		expect(body.mcp_endpoint).toBe('https://roamarr.example.com/mcp');
		expect(body.mcp_metadata_endpoint).toBe('https://roamarr.example.com/.well-known/mcp.json');
		expect(body.scopes_supported).toContain('trips:read');
		expect(body.code_challenge_methods_supported).toEqual(['S256']);
	});
});
