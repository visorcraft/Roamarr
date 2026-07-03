import { render } from 'svelte/server';
import type { Snippet } from 'svelte';
import { test, expect } from 'vitest';
import CollapseSection from './CollapseSection.svelte';

const children = (() => 'body content') as unknown as Snippet;

test('collapsed section exposes a button with aria-expanded=false and aria-controls', () => {
	const { body } = render(CollapseSection, { props: { title: 'More details', children } });
	expect(body).toContain('aria-expanded="false"');
	const match = body.match(/aria-controls="segment-section-\d+"/);
	expect(match, 'button must reference a panel via aria-controls').not.toBeNull();
	// panel is not rendered when closed
	expect(body).not.toContain('segment-form-section-body');
});

test('expanded section renders the controlled panel with a matching id', () => {
	const { body } = render(CollapseSection, { props: { title: 'More details', open: true, children } });
	expect(body).toContain('aria-expanded="true"');
	const controls = body.match(/aria-controls="(segment-section-\d+)"/);
	const panel = body.match(/id="(segment-section-\d+)"/);
	expect(controls, 'button needs aria-controls').not.toBeNull();
	expect(panel, 'panel needs an id').not.toBeNull();
	expect(controls![1]).toBe(panel![1]);
});
