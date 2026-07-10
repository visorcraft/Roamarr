import { randomBytes } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { verifyAccessToken } from '$lib/server/oauth';
import { createMcpServer } from '$lib/server/mcpServer';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { RequestHandler } from '@sveltejs/kit';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { deleteTransport, getTransport, registerTransport } from './transport';

function randomSessionId(): string {
	return randomBytes(16).toString('base64url');
}

function extractBearer(request: Request): string | null {
	const auth = request.headers.get('authorization') ?? '';
	if (!auth.startsWith('Bearer ')) return null;
	return auth.slice(7);
}

function unauthorizedJson(body: unknown, status = 401): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function jsonRpcError(message: string, status: number, code = -32000): Response {
	return new Response(
		JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }),
		{ status, headers: { 'Content-Type': 'application/json' } }
	);
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const limit = checkRateLimit(getClientAddress(), 'mcp', { maxAttempts: 120 });
	if (!limit.allowed) {
		return new Response(JSON.stringify({ error: 'Too many requests' }), {
			status: 429,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const bearer = extractBearer(request);
	if (!bearer) return unauthorizedJson({ error: 'Bearer token required' });
	const token = verifyAccessToken(bearer);
	if (!token) return unauthorizedJson({ error: 'Invalid or expired token' });

	const authInfo: AuthInfo = {
		token: bearer,
		clientId: token.clientId,
		scopes: token.scopes
	};

	const sessionId = request.headers.get('mcp-session-id');
	if (sessionId) {
		const transport = getTransport(sessionId);
		if (!transport) {
			return jsonRpcError('Session not found', 404);
		}
		return transport.handleRequest(request, { authInfo });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return jsonRpcError('Invalid JSON', 400, -32700);
	}

	if (!isInitializeRequest(body)) {
		return jsonRpcError('Bad Request: initialize request required', 400);
	}

	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: randomSessionId,
		// Return direct JSON responses for POST requests; GET remains available
		// for clients that prefer an SSE stream.
		enableJsonResponse: true,
		// Store the transport by session ID once initialization completes so
		// subsequent POST/GET/DELETE requests can reuse it.
		onsessioninitialized: (sid) => {
			registerTransport(sid, transport);
		}
	});

	transport.onclose = () => {
		const sid = transport.sessionId;
		if (sid) deleteTransport(sid);
	};

	const server = createMcpServer(token.userId, token.scopes);
	await server.connect(transport);
	return transport.handleRequest(request, { authInfo, parsedBody: body });
};

export const GET: RequestHandler = async ({ request, getClientAddress }) => {
	const limit = checkRateLimit(getClientAddress(), 'mcp', { maxAttempts: 120 });
	if (!limit.allowed) {
		return new Response(JSON.stringify({ error: 'Too many requests' }), {
			status: 429,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const bearer = extractBearer(request);
	if (!bearer) return unauthorizedJson({ error: 'Bearer token required' });
	const token = verifyAccessToken(bearer);
	if (!token) return unauthorizedJson({ error: 'Invalid or expired token' });

	const authInfo: AuthInfo = {
		token: bearer,
		clientId: token.clientId,
		scopes: token.scopes
	};

	const sessionId = request.headers.get('mcp-session-id');
	if (!sessionId) {
		return jsonRpcError('Bad Request: mcp-session-id header required', 400);
	}
	const transport = getTransport(sessionId);
	if (!transport) {
		return jsonRpcError('Session not found', 404);
	}
	return transport.handleRequest(request, { authInfo });
};

export const DELETE: RequestHandler = async ({ request, getClientAddress }) => {
	const limit = checkRateLimit(getClientAddress(), 'mcp', { maxAttempts: 120 });
	if (!limit.allowed) {
		return new Response(JSON.stringify({ error: 'Too many requests' }), {
			status: 429,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const bearer = extractBearer(request);
	if (!bearer) return unauthorizedJson({ error: 'Bearer token required' });
	const token = verifyAccessToken(bearer);
	if (!token) return unauthorizedJson({ error: 'Invalid or expired token' });

	const authInfo: AuthInfo = {
		token: bearer,
		clientId: token.clientId,
		scopes: token.scopes
	};

	const sessionId = request.headers.get('mcp-session-id');
	if (!sessionId) {
		return jsonRpcError('Bad Request: mcp-session-id header required', 400);
	}
	const transport = getTransport(sessionId);
	if (!transport) {
		return jsonRpcError('Session not found', 404);
	}
	return transport.handleRequest(request, { authInfo });
};
