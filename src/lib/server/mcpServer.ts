import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Scope } from './oauth';
import { requireConfirm } from './mcpHelpers';
import { MCP_TOOL_DEFINITIONS } from './mcpToolDefinitions';
import { registerMcpPromptsAndResources } from './mcpPromptsAndResources';
import {
	MCP_TOOL_REGISTRY,
	hasScope,
	scopeError,
	safeTripProjection
} from './mcpTools';

export function createMcpServer(userId: number, scopes: Scope[]): Server {
	const server = new Server(
		{ name: 'roamarr', version: '1.0.0' },
		{ capabilities: { tools: {}, prompts: {}, resources: {} } }
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOL_DEFINITIONS }));

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args = {} } = request.params;
		// Convert any thrown SvelteKit `error()` (404/400/etc.) from helper
		// functions into an MCP `isError: true` result instead of leaking
		// an unhandled 500 to the transport. Unknown tools and explicit
		// isError returns are unaffected.
		const toolHandler = async () => {
			const spec = MCP_TOOL_REGISTRY.get(name);
			if (!spec) {
				return {
					content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
					isError: true
				};
			}
			if (spec.scope && !hasScope(scopes, spec.scope)) return scopeError(spec.scope);
			if (spec.confirm) {
				const confirmErr = requireConfirm(args as Record<string, unknown>, name);
				if (confirmErr) return confirmErr;
			}
			return await spec.handler({
				userId,
				scopes,
				args: args as Record<string, unknown>
			});
		};
		try {
			return await toolHandler();
		} catch (e) {
			const status = (e as { status?: number })?.status;
			const body = (e as { body?: { message?: unknown } })?.body;
			const message =
				typeof body?.message === 'string' && body.message.length > 0
					? body.message
					: ((e as Error)?.message ?? String(e));
			return {
				content: [
					{
						type: 'text' as const,
						text: status ? `Error ${status}: ${message}` : `Error: ${message}`
					}
				],
				isError: true
			};
		}
	});

	registerMcpPromptsAndResources(server, { userId, scopes, safeTripProjection });

	return server;
}
