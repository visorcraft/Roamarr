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
 * Hints are described too: `.field-help` elements inside a field are linked
 * into `aria-describedby` as well, in DOM order before the error ids, with a
 * stable id derived from the control when the hint has none.
 *
 * Clears never remove tokens this module did not write: `aria-describedby` is
 * rebuilt from the union of foreign (template-authored) tokens and the ids
 * this module owns, so template-authored descriptions survive error clears and
 * duplicate ids are avoided by assigning unique ids to id-less messages.
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

const ownedTokens = new WeakMap<Control, Set<string>>();

function messages(field: HTMLElement, kind: 'field-help' | 'field-error'): HTMLElement[] {
	return Array.from(field.querySelectorAll<HTMLElement>(`.${kind}`)).filter(
		(el) => el.closest('.field') === field
	);
}

function tokens(control: Control): string[] {
	return (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
}

function syncDescribedBy(field: HTMLElement): void {
	const control = controlFor(field);
	if (!control || !control.id) return;
	const owned = ownedTokens.get(control);
	const hints = messages(field, 'field-help').map((el, i) => el.id || (el.id = `${control.id}-hint-${i + 1}`));
	const errors = messages(field, 'field-error').map((el, i) =>
		el.id || (el.id = i === 0 ? `${control.id}-error` : `${control.id}-error-${i + 1}`)
	);
	const own = Array.from(new Set([...hints, ...errors]));
	const foreign = Array.from(new Set(tokens(control).filter((t) => !owned?.has(t) && !own.includes(t))));
	ownedTokens.set(control, new Set(own));
	const ids = [...foreign, ...own];
	if (ids.length) control.setAttribute('aria-describedby', ids.join(' '));
	else control.removeAttribute('aria-describedby');
}

function wireError(errorEl: HTMLElement): void {
	const field = errorEl.closest<HTMLElement>('.field');
	if (!field) return;
	const control = controlFor(field);
	if (!control || !control.id) return;
	control.setAttribute('aria-invalid', 'true');
	syncDescribedBy(field);
}

function clearControl(field: HTMLElement): void {
	if (field.querySelector('.field-error')) {
		syncDescribedBy(field);
		return;
	}
	const control = controlFor(field);
	if (!control) return;
	control.removeAttribute('aria-invalid');
	syncDescribedBy(field);
}

function scan(root: ParentNode): void {
	root.querySelectorAll<HTMLElement>('.field-error').forEach(wireError);
	root.querySelectorAll<HTMLElement>('.field-help').forEach((el) => {
		const field = el.closest<HTMLElement>('.field');
		if (field) syncDescribedBy(field);
	});
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
				if (
					el.classList?.contains('field-error') ||
					el.classList?.contains('field-help') ||
					el.querySelector?.('.field-error, .field-help')
				) {
					scan(el.closest('.field') ?? el);
				}
			});
			m.removedNodes.forEach((node) => {
				if (node.nodeType !== 1) return;
				const removed = node as HTMLElement;
				// m.target is the former parent (the .field or inner wrapper). Guard
				// for element nodes only; do not rely on global Element constructors.
				const target = m.target as { nodeType: number; closest?: (s: string) => HTMLElement | null } | null;
				if (target && target.nodeType === 1 && typeof target.closest === 'function') {
					const field = target.closest('.field');
					if (!field) return;
					if (removed.classList?.contains('field-error') || removed.querySelector?.('.field-error')) {
						clearControl(field);
					} else if (removed.classList?.contains('field-help') || removed.querySelector?.('.field-help')) {
						syncDescribedBy(field);
					}
				}
			});
		}
	});
	observer.observe(doc.body, { childList: true, subtree: true });
	return () => observer.disconnect();
}
