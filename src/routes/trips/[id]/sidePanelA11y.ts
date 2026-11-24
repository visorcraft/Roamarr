/**
 * Breakpoint at which `.trip-modern-side-panel-open` becomes a fixed,
 * full-viewport overlay (see `@media (max-width: 860px)` in
 * `trip-detail-modern.css`). A test asserts the two stay in sync.
 */
export const SIDE_PANEL_MODAL_MEDIA = '(max-width: 860px)';

interface EscapeLike {
	key: string;
	defaultPrevented: boolean;
	target: EventTarget | null;
}

/**
 * Decide whether an Escape keypress should close the selected-segment side
 * panel. Nested dialogs and open combobox popups own their own Escape press.
 * In the full-screen presentation Escape closes from anywhere; side by side it
 * only closes when the key press originates inside the panel.
 */
export function shouldCloseSidePanel(
	event: EscapeLike,
	state: { open: boolean; modal: boolean; panel: Element | null }
): boolean {
	if (!state.open || event.key !== 'Escape' || event.defaultPrevented) return false;
	const target = event.target;
	if (target instanceof Element && target.closest('dialog[open], [role="combobox"][aria-expanded="true"]')) {
		return false;
	}
	if (state.modal) return true;
	return target instanceof Element && state.panel != null && state.panel.contains(target);
}
