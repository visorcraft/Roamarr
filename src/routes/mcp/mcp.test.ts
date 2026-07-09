import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { POST as mcpPost, GET as mcpGet } from './+server';
import { POST as tokenPost } from '../oauth/token/+server';
import { createClient, createAuthorizationCode } from '$lib/server/oauth';
import { oauthTokens, oauthClients } from '$lib/server/db/mongrelSchema';
import { makeUser, makeTrip, makeSegment } from '../../../tests/helpers';
import { resetRateLimit } from '$lib/server/rateLimit';

function pkcePair() {
	const verifier = randomBytes(32).toString('base64url');
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	return { verifier, challenge };
}

async function getAccessToken(userId: number, scopes: string[]): Promise<string> {
	const { client, plaintextSecret } = createClient(userId, {
		clientName: 'MCP Test',
		redirectUris: ['https://app.example/cb'],
		scopes: scopes as any
	});
	const { verifier, challenge } = pkcePair();
	const { code } = createAuthorizationCode({
		userId,
		clientId: client.clientId,
		scopes: scopes as any,
		codeChallenge: challenge,
		redirectUri: client.redirectUris[0]
	});
	const res = await tokenPost({
		request: new Request('http://localhost/oauth/token', {
			method: 'POST',
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				client_id: client.clientId,
				client_secret: plaintextSecret!,
				code_verifier: verifier
			})
		}),
		getClientAddress: () => '127.0.0.1'
	} as any);
	const body = await res.json();
	return body.access_token;
}

function initRequest(token: string, body: unknown): Request {
	return new Request('http://localhost/mcp', {
		method: 'POST',
		body: JSON.stringify(body),
		headers: {
			'Authorization': `Bearer ${token}`,
			'Content-Type': 'application/json',
			'Accept': 'application/json, text/event-stream'
		}
	});
}

describe('mcp route', () => {
	let userId: number;
	let accessToken: string;

	beforeEach(() => {
		resetRateLimit();
		ctx.kit.deleteFrom(oauthTokens).executeSync();
		ctx.kit.deleteFrom(oauthClients).executeSync();
		userId = makeUser(ctx.kit).id;
	});

	test('POST without token returns 401', async () => {
		const res = await mcpPost({
			request: new Request('http://localhost/mcp', { method: 'POST', body: '{}' }),
			getClientAddress: () => '127.0.0.1'
		} as any);
		expect(res.status).toBe(401);
	});

	test('initialize request returns a session id', async () => {
		accessToken = await getAccessToken(userId, ['trips:read']);
		const res = await mcpPost({
			request: initRequest(accessToken, {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
			}),
			getClientAddress: () => '127.0.0.1'
		} as any);

		expect(res.status).toBe(200);
		const sessionId = res.headers.get('mcp-session-id');
		expect(sessionId).toBeTruthy();
		const body = await res.json();
		expect(body.result.protocolVersion).toBeDefined();
	});

	test('non-initialize POST without session id returns 400', async () => {
		accessToken = await getAccessToken(userId, ['trips:read']);
		const res = await mcpPost({
			request: initRequest(accessToken, {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list'
			}),
			getClientAddress: () => '127.0.0.1'
		} as any);
		expect(res.status).toBe(400);
	});

	test('session reuse allows tools/list', async () => {
		accessToken = await getAccessToken(userId, ['trips:read']);
		const init = await mcpPost({
			request: initRequest(accessToken, {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
			}),
			getClientAddress: () => '127.0.0.1'
		} as any);
		const sessionId = init.headers.get('mcp-session-id')!;

		const res = await mcpPost({
			request: new Request('http://localhost/mcp', {
				method: 'POST',
				body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
				headers: {
					'Authorization': `Bearer ${accessToken}`,
					'Content-Type': 'application/json',
					'Accept': 'application/json, text/event-stream',
					'mcp-session-id': sessionId
				}
			}),
			getClientAddress: () => '127.0.0.1'
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		const names = body.result.tools.map((t: any) => t.name);
		expect(names).toContain('roamarr_trip_list');
	});

	test('GET requires a valid session id', async () => {
		accessToken = await getAccessToken(userId, ['trips:read']);
		const init = await mcpPost({
			request: initRequest(accessToken, {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
			}),
			getClientAddress: () => '127.0.0.1'
		} as any);
		const sessionId = init.headers.get('mcp-session-id')!;

		const res = await mcpGet({
			request: new Request('http://localhost/mcp', {
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${accessToken}`,
					'Accept': 'text/event-stream',
					'mcp-session-id': sessionId
				}
			}),
			getClientAddress: () => '127.0.0.1'
		} as any);

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/event-stream');
	});

	test('tool call does not leak sensitive plaintext', async () => {
		const trip = makeTrip(ctx.kit, userId, {
			name: 'Secret Trip',
			notes: 'very secret notes',
			startDate: '2026-07-01'
		});
		makeSegment(ctx.kit, trip.id, {
			type: 'flight',
			title: 'Flight 1',
			confirmationNumber: 'ABC123',
			detailsJson: { recordLocator: 'XYZ' },
			startAt: '2026-07-01T10:00:00Z'
		});

		accessToken = await getAccessToken(userId, ['trips:read']);
		const init = await mcpPost({
			request: initRequest(accessToken, {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
			}),
			getClientAddress: () => '127.0.0.1'
		} as any);
		const sessionId = init.headers.get('mcp-session-id')!;

		const res = await mcpPost({
			request: new Request('http://localhost/mcp', {
				method: 'POST',
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 2,
					method: 'tools/call',
					params: { name: 'roamarr_trip_get', arguments: { tripId: trip.id } }
				}),
				headers: {
					'Authorization': `Bearer ${accessToken}`,
					'Content-Type': 'application/json',
					'Accept': 'application/json, text/event-stream',
					'mcp-session-id': sessionId
				}
			}),
			getClientAddress: () => '127.0.0.1'
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		const text = JSON.stringify(body);
		expect(text).not.toContain('very secret notes');
		expect(text).not.toContain('ABC123');
		expect(text).not.toContain('recordLocator');
	});

	test('invalid trip status is rejected', async () => {
		const trip = makeTrip(ctx.kit, userId, { name: 'Trip' });
		accessToken = await getAccessToken(userId, ['trips:write']);
		const init = await mcpPost({
			request: initRequest(accessToken, {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
			}),
			getClientAddress: () => '127.0.0.1'
		} as any);
		const sessionId = init.headers.get('mcp-session-id')!;

		const res = await mcpPost({
			request: new Request('http://localhost/mcp', {
				method: 'POST',
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 2,
					method: 'tools/call',
					params: { name: 'roamarr_trip_update', arguments: { tripId: trip.id, status: 'bogus' } }
				}),
				headers: {
					'Authorization': `Bearer ${accessToken}`,
					'Content-Type': 'application/json',
					'Accept': 'application/json, text/event-stream',
					'mcp-session-id': sessionId
				}
			}),
			getClientAddress: () => '127.0.0.1'
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.result.content[0].text).toContain('status must be one of');
	});
});
