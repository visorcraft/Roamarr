const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keyboard-focusable controls inside `root`, in DOM order. */
export function focusableWithin(root: ParentNode): HTMLElement[] {
	const seen = new Set<HTMLElement>();
	for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) {
		if (el.getAttribute('tabindex') === '-1') continue;
		if (el.closest('[hidden], [aria-hidden="true"]')) continue;
		seen.add(el);
	}
	return [...seen];
}

/**
 * Element that must receive focus for a Tab / Shift+Tab keypress issued while
 * `active` is focused inside the modal `root`. Returns null when the browser's
 * native Tab move already stays inside `root`.
 */
export function wrappedTabTarget(
	root: HTMLElement | null,
	active: Element | null,
	shiftKey: boolean
): HTMLElement | null {
	if (!root) return null;
	const items = focusableWithin(root);
	if (items.length === 0) return root.hasAttribute('tabindex') ? root : null;
	const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
	if (index === -1) return shiftKey ? items[items.length - 1] : items[0];
	if (!shiftKey && index === items.length - 1) return items[0];
	if (shiftKey && index === 0) return items[items.length - 1];
	return null;
}

/**
 * Where focus goes when the viewer closes: the thumbnail of the photo that was
 * last viewed, else the element focused before the viewer opened.
 */
export function lightboxReturnTarget(
	root: HTMLElement | null,
	index: number | null,
	previous: HTMLElement | null
): HTMLElement | null {
	if (root && index != null) {
		const thumb = root.querySelector<HTMLElement>(`[data-gallery-index="${index}"]`);
		if (thumb?.isConnected) return thumb;
	}
	return previous?.isConnected ? previous : null;
}
