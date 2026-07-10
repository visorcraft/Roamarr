import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

// Session/transport registry for the MCP streamable-HTTP endpoint. Lives outside
// +server.ts because SvelteKit route modules may only export request handlers.
const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();
const transportLastUsed = new Map<string, number>();
const MAX_MCP_SESSIONS = 1_000;
export const MCP_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

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

export function deleteTransport(sessionId: string): void {
	transports.delete(sessionId);
	transportLastUsed.delete(sessionId);
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
