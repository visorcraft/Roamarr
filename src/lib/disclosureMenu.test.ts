import { test, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { installDisclosureMenus } from './disclosureMenu';

function buildDom(menuCount = 1) {
	const menus = Array.from(
		{ length: menuCount },
		(_, i) => `
		<details class="app-user-menu" open>
			<summary id="summary-${i}">Menu ${i}</summary>
			<div>
				<a href="#" id="item-${i}">Item ${i}</a>
			</div>
		</details>`
	).join('');
	return new JSDOM(`<!DOCTYPE html><body>${menus}<button id="outside" type="button">Outside</button></body>`);
}

test('Escape on a link inside an open menu closes it, focuses the summary, and stops propagation', () => {
	const dom = buildDom(1);
	const doc = dom.window.document;
	const menu = doc.querySelector<HTMLDetailsElement>('details.app-user-menu')!;
	const summary = menu.querySelector('summary')!;
	const link = doc.getElementById('item-0')!;
	const focusSpy = vi.spyOn(summary, 'focus');
	const windowSpy = vi.fn();
	dom.window.addEventListener('keydown', windowSpy);
	const disconnect = installDisclosureMenus(doc);

	const event = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
	link.dispatchEvent(event);

	expect(menu.open).toBe(false);
	expect(event.defaultPrevented).toBe(true);
	expect(focusSpy).toHaveBeenCalledTimes(1);
	expect(windowSpy).not.toHaveBeenCalled();
	disconnect();
	dom.window.removeEventListener('keydown', windowSpy);
});

test('Escape on the summary of a closed menu leaves it closed and does not stop propagation', () => {
	const dom = buildDom(1);
	const doc = dom.window.document;
	const menu = doc.querySelector<HTMLDetailsElement>('details.app-user-menu')!;
	menu.open = false;
	const summary = menu.querySelector('summary')!;
	const windowSpy = vi.fn();
	dom.window.addEventListener('keydown', windowSpy);
	const disconnect = installDisclosureMenus(doc);

	const event = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
	summary.dispatchEvent(event);

	expect(menu.open).toBe(false);
	expect(event.defaultPrevented).toBe(false);
	expect(windowSpy).toHaveBeenCalledTimes(1);
	disconnect();
	dom.window.removeEventListener('keydown', windowSpy);
});

test('Escape on an unrelated button outside any menu leaves everything untouched', () => {
	const dom = buildDom(1);
	const doc = dom.window.document;
	const menu = doc.querySelector<HTMLDetailsElement>('details.app-user-menu')!;
	const button = doc.getElementById('outside')!;
	const disconnect = installDisclosureMenus(doc);

	const event = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
	button.dispatchEvent(event);

	expect(menu.open).toBe(true);
	expect(event.defaultPrevented).toBe(false);
	disconnect();
});

test('Escape inside one of two open menus closes only that menu', () => {
	const dom = buildDom(2);
	const doc = dom.window.document;
	const menus = doc.querySelectorAll<HTMLDetailsElement>('details.app-user-menu');
	const menu = menus[0];
	const other = menus[1];
	const link = doc.getElementById('item-0')!;
	const disconnect = installDisclosureMenus(doc);

	const event = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
	link.dispatchEvent(event);

	expect(menu.open).toBe(false);
	expect(other.open).toBe(true);
	disconnect();
});

test('focusout to an outside button closes the menu without focusing anything', () => {
	const dom = buildDom(1);
	const doc = dom.window.document;
	const menu = doc.querySelector<HTMLDetailsElement>('details.app-user-menu')!;
	const summary = menu.querySelector('summary')!;
	const link = doc.getElementById('item-0')!;
	const button = doc.getElementById('outside')!;
	const summaryFocusSpy = vi.spyOn(summary, 'focus');
	const buttonFocusSpy = vi.spyOn(button, 'focus');
	const disconnect = installDisclosureMenus(doc);

	const event = new dom.window.FocusEvent('focusout', { bubbles: true, cancelable: true, relatedTarget: button });
	link.dispatchEvent(event);

	expect(menu.open).toBe(false);
	expect(summaryFocusSpy).not.toHaveBeenCalled();
	expect(buttonFocusSpy).not.toHaveBeenCalled();
	disconnect();
});

test('focusout to another item inside the same menu leaves it open', () => {
	const dom = buildDom(1);
	const doc = dom.window.document;
	const menu = doc.querySelector<HTMLDetailsElement>('details.app-user-menu')!;
	const link = doc.getElementById('item-0')!;
	const inner = doc.createElement('a');
	inner.href = '#';
	inner.textContent = 'Inner';
	menu.querySelector('div')!.appendChild(inner);
	const disconnect = installDisclosureMenus(doc);

	const event = new dom.window.FocusEvent('focusout', { bubbles: true, cancelable: true, relatedTarget: inner });
	link.dispatchEvent(event);

	expect(menu.open).toBe(true);
	disconnect();
});

test('focusout with a null relatedTarget leaves the menu open', () => {
	const dom = buildDom(1);
	const doc = dom.window.document;
	const menu = doc.querySelector<HTMLDetailsElement>('details.app-user-menu')!;
	const link = doc.getElementById('item-0')!;
	const disconnect = installDisclosureMenus(doc);

	const event = new dom.window.FocusEvent('focusout', { bubbles: true, cancelable: true });
	link.dispatchEvent(event);

	expect(menu.open).toBe(true);
	disconnect();
});

test('click outside closes the menu, while a click on a menu item leaves it open', () => {
	const dom = buildDom(1);
	const doc = dom.window.document;
	const menu = doc.querySelector<HTMLDetailsElement>('details.app-user-menu')!;
	const button = doc.getElementById('outside')!;
	const link = doc.getElementById('item-0')!;
	const disconnect = installDisclosureMenus(doc);

	button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
	expect(menu.open).toBe(false);

	menu.open = true;
	link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
	expect(menu.open).toBe(true);
	disconnect();
});

test('Escape after the disposer runs no longer closes the menu', () => {
	const dom = buildDom(1);
	const doc = dom.window.document;
	const menu = doc.querySelector<HTMLDetailsElement>('details.app-user-menu')!;
	const link = doc.getElementById('item-0')!;
	const disconnect = installDisclosureMenus(doc);
	disconnect();

	const event = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
	link.dispatchEvent(event);

	expect(menu.open).toBe(true);
	expect(event.defaultPrevented).toBe(false);
});

test('returns a no-op disposer when no root resolves (SSR/node)', () => {
	const dispose = installDisclosureMenus(undefined as unknown as Document);
	expect(typeof dispose).toBe('function');
	expect(() => dispose()).not.toThrow();
});

test('layout wires disclosure menus in onMount', () => {
	const source = readFileSync(new URL('../routes/+layout.svelte', import.meta.url), 'utf8');
	expect(source).toContain("import { installDisclosureMenus } from '$lib/disclosureMenu';");
	expect(source).toContain('installDisclosureMenus();');
	const cleanupAnchor = source.indexOf('disconnectPickerInputs();');
	const disconnectCall = source.indexOf('disconnectDisclosureMenus();');
	expect(cleanupAnchor).toBeGreaterThan(-1);
	expect(disconnectCall).toBeGreaterThan(cleanupAnchor);
});
