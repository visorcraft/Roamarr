import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { verifyAccessToken } from '$lib/server/oauth';
import { createMcpServer } from '$lib/server/mcpServer';
import type { RequestHandler } from '@sveltejs/kit';

async function handleJsonRpc(userId: number, scopes: any[], body: unknown): Promise<unknown> {
	const server = createMcpServer(userId, scopes);
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);

	await clientTransport.send(body as any);

	let response: unknown = null;
	const originalSend = clientTransport.send.bind(clientTransport);
	clientTransport.send = async (msg: any) => {
		response = msg;
	};

	const close = () => {
		try { server.close(); } catch { /* noop */ }
	};

	await new Promise((resolve) => {
		const timer = setTimeout(() => { resolve(undefined); }, 5000);
		clientTransport.onclose = () => { clearTimeout(timer); resolve(undefined); };
	});

	close();
	return response;
}

export const POST: RequestHandler = async ({ request }) => {
	const auth = request.headers.get('authorization') ?? '';
	if (!auth.startsWith('Bearer ')) {
		return new Response(JSON.stringify({ error: 'Bearer token required' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}
	const token = auth.slice(7);
	const authInfo = verifyAccessToken(token);
	if (!authInfo) {
		return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const result = await handleJsonRpc(authInfo.userId, authInfo.scopes, body);
	return new Response(JSON.stringify(result), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
};

export const GET: RequestHandler = () =>
	new Response(JSON.stringify({ error: 'Use POST' }), {
		status: 405,
		headers: { 'Content-Type': 'application/json' }
	});
