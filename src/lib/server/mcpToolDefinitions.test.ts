import { describe, test, expect } from 'vitest';
import { MCP_TOOL_DEFINITIONS } from './mcpToolDefinitions';
import { TRIP_STATUSES, SEGMENT_TYPES, TRAVEL_DOCUMENT_TYPES } from './db/mongrelSchema';

describe('MCP_TOOL_DEFINITIONS', () => {
	test('contains 144 tools with unique roamarr_-prefixed names', () => {
		expect(MCP_TOOL_DEFINITIONS).toHaveLength(144);
		const names = MCP_TOOL_DEFINITIONS.map((tool) => tool.name);
		expect(new Set(names).size).toBe(names.length);
		for (const name of names) {
			expect(name.startsWith('roamarr_')).toBe(true);
		}
	});

	test('every tool has a non-empty description and an object inputSchema', () => {
		for (const tool of MCP_TOOL_DEFINITIONS) {
			expect(tool.description?.trim().length).toBeGreaterThan(0);
			expect(tool.inputSchema?.type).toBe('object');
		}
	});

	test('enum schemas stay synced with schema constants', () => {
		const enums: string[][] = [];
		const collectEnums = (node: unknown): void => {
			if (node == null || typeof node !== 'object') return;
			if (Array.isArray(node)) {
				for (const item of node) collectEnums(item);
				return;
			}
			const obj = node as Record<string, unknown>;
			if (Array.isArray(obj.enum) && obj.enum.every((v) => typeof v === 'string')) {
				enums.push(obj.enum as string[]);
			}
			for (const value of Object.values(obj)) collectEnums(value);
		};
		for (const tool of MCP_TOOL_DEFINITIONS) collectEnums(tool.inputSchema);

		expect(enums).toContainEqual([...TRIP_STATUSES]);
		expect(enums).toContainEqual([...SEGMENT_TYPES]);
		expect(enums).toContainEqual([...TRAVEL_DOCUMENT_TYPES]);
	});
});
