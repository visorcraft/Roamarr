/**
 * Progressive enhancement that links rendered field errors to their inputs for
 * assistive technology.
 *
 * Roamarr's form pattern renders `<div class="field">` containing a control
 * (`<input>`/`<select>`/`<textarea>`) and an optional `<p class="field-error">`
 * that only appears when the field has a validation error. This module wires
 * the association the templates do not: when a `.field-error` is present it
 * marks the control `aria-invalid="true"` and points `aria-describedby` at the
 * message (giving it a stable id derived from the control). When the error is
 * removed the attributes are cleared.
 *
 * It runs as a single MutationObserver installed once from the app layout, so
 * it covers every form (including inline patterns) without per-template wiring,
 * and stays correct as errors appear/disappear after enhanced form submits.
 * Attributes are applied client-side after hydration; the initial server HTML
 * is unchanged.
 */

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function controlFor(field: HTMLElement): Control | null {
	return field.querySelector<Control>('input, select, textarea');
}

function wireError(errorEl: HTMLElement): void {
	const field = errorEl.closest<HTMLElement>('.field');
	if (!field) return;
	const control = controlFor(field);
	if (!control || !control.id) return;
	if (!errorEl.id) errorEl.id = `${control.id}-error`;
	control.setAttribute('aria-invalid', 'true');
	control.setAttribute('aria-describedby', errorEl.id);
}

function clearControl(field: HTMLElement): void {
	if (field.querySelector('.field-error')) return;
	const control = controlFor(field);
	if (!control) return;
	control.removeAttribute('aria-invalid');
	control.removeAttribute('aria-describedby');
}

function scan(root: ParentNode): void {
	root.querySelectorAll<HTMLElement>('.field-error').forEach(wireError);
}

/**
 * Install the observer. Returns a disconnect function.
 * No-ops when `document` is absent (SSR).
 */
export function installFieldErrorA11y(doc: Document = document): () => void {
	const win = (doc.defaultView ??
		(typeof window !== 'undefined' ? window : null)) as (Window & typeof globalThis) | null;
	if (!win || !doc.body || typeof win.MutationObserver === 'undefined') {
		return () => {};
	}
	scan(doc.body);

	const observer = new win.MutationObserver((mutations) => {
		for (const m of mutations) {
			m.addedNodes.forEach((node) => {
				if (node.nodeType !== 1) return;
				const el = node as HTMLElement;
				if (el.classList?.contains('field-error')) wireError(el);
				else if (el.querySelector?.('.field-error')) scan(el);
			});
			m.removedNodes.forEach((node) => {
				if (node.nodeType !== 1) return;
				const removed = node as HTMLElement;
				if (!removed.classList?.contains('field-error')) return;
				// m.target is the former parent (the .field or inner wrapper). Guard
				// for element nodes only; do not rely on global Element constructors.
				const target = m.target as { nodeType: number; closest?: (s: string) => HTMLElement | null } | null;
				if (target && target.nodeType === 1 && typeof target.closest === 'function') {
					const field = target.closest('.field');
					if (field) clearControl(field);
				}
			});
		}
	});
	observer.observe(doc.body, { childList: true, subtree: true });
	return () => observer.disconnect();
}
