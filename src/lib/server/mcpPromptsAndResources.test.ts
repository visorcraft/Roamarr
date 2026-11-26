import { describe, test, expect, vi } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { MCP_PROMPTS, MCP_RESOURCE_TEMPLATES } from './mcpPromptsAndResources';

describe('MCP_PROMPTS', () => {
	test('has 16 prompts with unique names and non-empty descriptions', () => {
		expect(MCP_PROMPTS).toHaveLength(16);
		const names = MCP_PROMPTS.map((p) => p.name);
		expect(new Set(names).size).toBe(16);
		for (const p of MCP_PROMPTS) {
			expect(p.description.trim().length).toBeGreaterThan(0);
		}
	});
});

describe('MCP_RESOURCE_TEMPLATES', () => {
	test('has 9 templates with unique names, unique uriTemplates, and application/json mimeType', () => {
		expect(MCP_RESOURCE_TEMPLATES).toHaveLength(9);
		const names = MCP_RESOURCE_TEMPLATES.map((t) => t.name);
		expect(new Set(names).size).toBe(9);
		const uriTemplates = MCP_RESOURCE_TEMPLATES.map((t) => t.uriTemplate);
		expect(new Set(uriTemplates).size).toBe(9);
		for (const t of MCP_RESOURCE_TEMPLATES) {
			expect(t.mimeType).toBe('application/json');
		}
	});
});
