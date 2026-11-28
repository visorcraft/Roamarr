import type { McpToolModule, McpToolSpec } from './context';
import { tripsAndSegmentsTools } from './tripsAndSegments';
import { planningTools } from './planning';
import { walletTools } from './wallet';
import { sharingAndContactsTools } from './sharingAndContacts';
import { accountAndTemplatesTools } from './accountAndTemplates';
import { tripExtrasTools } from './tripExtras';
import { placesAndMediaTools } from './placesAndMedia';

const TOOL_MODULES: readonly McpToolModule[] = [
	tripsAndSegmentsTools,
	planningTools,
	walletTools,
	sharingAndContactsTools,
	accountAndTemplatesTools,
	tripExtrasTools,
	placesAndMediaTools
];

function buildToolRegistry(modules: readonly McpToolModule[]): ReadonlyMap<string, McpToolSpec> {
	const registry = new Map<string, McpToolSpec>();
	for (const mod of modules) {
		for (const [name, spec] of Object.entries(mod)) {
			if (registry.has(name)) {
				throw new Error(`Duplicate MCP tool registration: ${name}`);
			}
			registry.set(name, spec);
		}
	}
	return registry;
}

export const MCP_TOOL_REGISTRY: ReadonlyMap<string, McpToolSpec> = buildToolRegistry(TOOL_MODULES);

export {
	hasScope,
	scopeError,
	safeTripProjection,
	type McpToolContext,
	type McpToolModule,
	type McpToolResult,
	type McpToolSpec
} from './context';
