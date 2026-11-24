// @vitest-environment jsdom
import { describe, test, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SIDE_PANEL_MODAL_MEDIA, shouldCloseSidePanel } from './sidePanelA11y';

let panel: HTMLElement;
let insideButton: HTMLButtonElement;
let outsideButton: HTMLButtonElement;

function escapeEvent(target: EventTarget | null, defaultPrevented = false) {
	return { key: 'Escape', defaultPrevented, target };
}

beforeEach(() => {
	document.body.innerHTML = '';
	panel = document.createElement('aside');
	insideButton = document.createElement('button');
	panel.appendChild(insideButton);
	outsideButton = document.createElement('button');
	document.body.appendChild(panel);
	document.body.appendChild(outsideButton);
});

describe('shouldCloseSidePanel', () => {
	test('returns false when open is false, even for Escape inside the panel', () => {
		const state = { open: false, modal: true, panel };
		expect(shouldCloseSidePanel(escapeEvent(insideButton), state)).toBe(false);
		expect(shouldCloseSidePanel(escapeEvent(insideButton), { open: false, modal: false, panel })).toBe(false);
	});

	test('returns false for non-Escape keys with the panel open', () => {
		const state = { open: true, modal: false, panel };
		expect(shouldCloseSidePanel({ key: 'Enter', defaultPrevented: false, target: insideButton }, state)).toBe(false);
		expect(shouldCloseSidePanel({ key: 'Tab', defaultPrevented: false, target: insideButton }, state)).toBe(false);
	});

	test('returns false when defaultPrevented is true', () => {
		const state = { open: true, modal: true, panel };
		expect(shouldCloseSidePanel(escapeEvent(outsideButton, true), state)).toBe(false);
	});

	test('side by side: true inside the panel, false outside, false for null target and null panel', () => {
		const state = { open: true, modal: false, panel };
		expect(shouldCloseSidePanel(escapeEvent(insideButton), state)).toBe(true);
		expect(shouldCloseSidePanel(escapeEvent(outsideButton), state)).toBe(false);
		expect(shouldCloseSidePanel(escapeEvent(null), state)).toBe(false);
		expect(shouldCloseSidePanel(escapeEvent(insideButton), { open: true, modal: false, panel: null })).toBe(false);
	});

	test('full-screen: true for the outside button and for a null target', () => {
		const state = { open: true, modal: true, panel };
		expect(shouldCloseSidePanel(escapeEvent(outsideButton), state)).toBe(true);
		expect(shouldCloseSidePanel(escapeEvent(null), state)).toBe(true);
		expect(shouldCloseSidePanel(escapeEvent(insideButton), state)).toBe(true);
	});

	test('returns false for a button inside <dialog open> in both modes', () => {
		const dialog = document.createElement('dialog');
		dialog.setAttribute('open', '');
		const dialogButton = document.createElement('button');
		dialog.appendChild(dialogButton);
		document.body.appendChild(dialog);

		expect(shouldCloseSidePanel(escapeEvent(dialogButton), { open: true, modal: false, panel })).toBe(false);
		expect(shouldCloseSidePanel(escapeEvent(dialogButton), { open: true, modal: true, panel })).toBe(false);
	});

	test('returns false for an open combobox target, true for the same input with aria-expanded="false" (side by side, inside the panel)', () => {
		const combobox = document.createElement('input');
		combobox.setAttribute('role', 'combobox');
		combobox.setAttribute('aria-expanded', 'true');
		panel.appendChild(combobox);
		const state = { open: true, modal: false, panel };
		expect(shouldCloseSidePanel(escapeEvent(combobox), state)).toBe(false);

		combobox.setAttribute('aria-expanded', 'false');
		expect(shouldCloseSidePanel(escapeEvent(combobox), state)).toBe(true);
	});

	test('SIDE_PANEL_MODAL_MEDIA matches the CSS breakpoint', () => {
		const css = readFileSync(join(import.meta.dirname, 'trip-detail-modern.css'), 'utf8');
		const match = css.match(/@media \(([^)]*)\) \{\s*\.trip-modern-side-panel-open \{/);
		expect(match).not.toBeNull();
		expect(match![1]).toBe('max-width: 860px');
		expect(SIDE_PANEL_MODAL_MEDIA).toBe(`(${match![1]})`);
	});
});
