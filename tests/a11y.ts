import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';

export interface AxeViolation {
	id: string;
	impact: string | null | undefined;
	help: string;
	description: string;
	helpUrl: string;
	nodes: { html: string; target: string[]; failureSummary?: string }[];
}

// Document-level checks that are meaningful only for a full page (lang, <title>,
// landmark/heading-on-page, focus order). They are validated separately and are
// not relevant when auditing an isolated component fragment.
const COMPONENT_DISABLED_RULES = {
	'color-contrast': { enabled: false },
	region: { enabled: false },
	'html-has-lang': { enabled: false },
	'document-title': { enabled: false },
	'bypass': { enabled: false },
	'page-has-heading-one': { enabled: false },
	'heading-order': { enabled: false },
	'landmark-unique': { enabled: false }
} as const;

/**
 * Render a Svelte component to HTML (SSR, matching the repo's existing
 * component-test pattern) and run axe-core against it in a jsdom document.
 * Returns any violations found.
 */
export async function checkA11y(
	component: Component<any>,
	props: Record<string, unknown> = {},
	rules?: Record<string, { enabled: boolean }>
): Promise<AxeViolation[]> {
	const { body } = render(component, { props });
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${body}</body></html>`, {
		pretendToBeVisual: true,
		url: 'http://localhost/'
	});
	const win = dom.window;
	const g = globalThis as Record<string, unknown>;
	const keys = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement'] as const;
	// Some of these (e.g. Node 22's `navigator`) are read-only getters, so use
	// defineProperty to swap them and restore the original descriptors afterwards.
	const saved = keys.map((k) => [k, Object.getOwnPropertyDescriptor(g, k)] as const);
	for (const k of keys) {
		Object.defineProperty(g, k, {
			value: win[k],
			configurable: true,
			writable: true
		});
	}
	try {
		const results = await axe.run(win.document.body, {
			rules: { ...COMPONENT_DISABLED_RULES, ...rules }
		});
		return results.violations.map((v) => ({
			id: v.id,
			impact: v.impact,
			help: v.help,
			description: v.description,
			helpUrl: v.helpUrl,
			nodes: v.nodes.map((n) => ({
				html: n.html,
				target: n.target as string[],
				failureSummary: n.failureSummary
			}))
		}));
	} finally {
		for (const [k, descriptor] of saved) {
			if (descriptor) {
				Object.defineProperty(g, k, descriptor);
			} else {
				delete g[k];
			}
		}
	}
}

/** Format violations into a readable multi-line string for assertion messages. */
export function formatViolations(violations: AxeViolation[]): string {
	if (violations.length === 0) return 'No accessibility violations.';
	return violations
		.map((v) => {
			const targets = v.nodes.map((n) => `    ${n.html}`).join('\n');
			return `  [${v.id}] (${v.impact}) ${v.help}\n  ${v.helpUrl}\n${targets}`;
		})
		.join('\n');
}
