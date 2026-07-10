import { randomBytes } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { verifyAccessToken } from '$lib/server/oauth';
import { createMcpServer } from '$lib/server/mcpServer';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { RequestHandler } from '@sveltejs/kit';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();
const transportLastUsed = new Map<string, number>();
const MAX_MCP_SESSIONS = 1_000;
export const MCP_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

function randomSessionId(): string {
	return randomBytes(16).toString('base64url');
}

function recordTransportUse(sessionId: string, now: number = Date.now()) {
	transportLastUsed.set(sessionId, now);
}

export function pruneStaleTransports(now: number = Date.now()): void {
	const cutoff = now - MCP_SESSION_TTL_MS;
	for (const [sessionId, lastUsed] of transportLastUsed) {
		if (lastUsed < cutoff) {
			transports.delete(sessionId);
			transportLastUsed.delete(sessionId);
		}
	}
}

export function registerTransport(
	sessionId: string,
	transport: WebStandardStreamableHTTPServerTransport,
	now: number = Date.now()
) {
	pruneStaleTransports(now);
	while (transports.size >= MAX_MCP_SESSIONS) {
		const oldest = transportLastUsed.keys().next().value;
		if (!oldest) break;
		transports.delete(oldest);
		transportLastUsed.delete(oldest);
	}
	transports.set(sessionId, transport);
	recordTransportUse(sessionId, now);
}

export function getTransport(
	sessionId: string
): WebStandardStreamableHTTPServerTransport | undefined {
	// Reap idle sessions on every request, not only when a new session initializes,
	// so a long quiet stretch cannot keep up to MAX_MCP_SESSIONS stale transports
	// (each holding a server + stream state) resident until the process restarts.
	pruneStaleTransports();
	const t = transports.get(sessionId);
	if (t) recordTransportUse(sessionId);
	return t;
}

/** Current number of live MCP transports. Exported for tests/diagnostics. */
export function getMcpTransportCount(): number {
	return transports.size;
}

/** Test/diagnostic helper: drop every tracked transport. */
export function resetMcpTransports(): void {
	transports.clear();
	transportLastUsed.clear();
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
		if (sid) {
			transports.delete(sid);
			transportLastUsed.delete(sid);
		}
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
