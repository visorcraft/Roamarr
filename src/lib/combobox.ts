/**
 * Shared combobox primitives used by the Autocomplete and CityAutocomplete
 * components: option id construction, IME composition guard, keyboard-key
 * resolution, blur-close timer, and debounced sequence-guarded lookup.
 */

/** Stable DOM id for the i-th option of a combobox named `name`. */
export function comboboxOptionId(name: string, index: number): string {
	return `${name}-option-${index}`;
}

/**
 * IME composition guard. Safari reports `isComposing === false` with keyCode
 * 229 for the Enter that commits a composition, so keyCode 229 must be treated
 * as an in-composition event even when isComposing is false.
 */
export function isImeCompositionEvent(event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean {
	return Boolean(event.isComposing || event.keyCode === 229);
}

export type ComboboxKeyResult =
	| { kind: 'ignore' }
	| { kind: 'update'; open: boolean; activeIndex: number; preventDefault: boolean }
	| { kind: 'select'; index: number; preventDefault: true };

/**
 * Resolve a keydown against the current combobox state into an intent the
 * component can apply. Never mutates state; never touches the DOM.
 */
export function resolveComboboxKeydown(
	event: Pick<KeyboardEvent, 'key' | 'isComposing' | 'keyCode'>,
	state: { open: boolean; activeIndex: number; count: number }
): ComboboxKeyResult {
	if (isImeCompositionEvent(event)) return { kind: 'ignore' };
	if (state.count === 0) {
		if (event.key === 'Escape' && state.open) {
			return { kind: 'update', open: false, activeIndex: state.activeIndex, preventDefault: false };
		}
		return { kind: 'ignore' };
	}
	switch (event.key) {
		case 'ArrowDown':
			return {
				kind: 'update',
				open: true,
				activeIndex: !state.open ? 0 : (state.activeIndex + 1) % state.count,
				preventDefault: true
			};
		case 'ArrowUp':
			return {
				kind: 'update',
				open: true,
				activeIndex: !state.open ? state.count - 1 : (state.activeIndex - 1 + state.count) % state.count,
				preventDefault: true
			};
		case 'Home':
			return state.open
				? { kind: 'update', open: true, activeIndex: 0, preventDefault: true }
				: { kind: 'ignore' };
		case 'End':
			return state.open
				? { kind: 'update', open: true, activeIndex: state.count - 1, preventDefault: true }
				: { kind: 'ignore' };
		case 'Enter':
			return state.open && state.activeIndex >= 0
				? { kind: 'select', index: state.activeIndex, preventDefault: true }
				: { kind: 'ignore' };
		case 'Escape':
			return state.open
				? { kind: 'update', open: false, activeIndex: -1, preventDefault: true }
				: { kind: 'ignore' };
		default:
			return { kind: 'ignore' };
	}
}

/**
 * Debounced blur-close timer. Never creates a timer at construction time so it
 * is safe to construct during SSR. `schedule()` cancels any pending timer
 * before arming a new one; the handle is cleared before `onClose()` runs.
 */
export function createBlurCloseTimer(
	onClose: () => void,
	delayMs = 150
): { schedule(): void; cancel(): void } {
	let handle: ReturnType<typeof setTimeout> | null = null;
	return {
		schedule() {
			if (handle) clearTimeout(handle);
			handle = setTimeout(() => {
				handle = null;
				onClose();
			}, delayMs);
		},
		cancel() {
			if (handle) {
				clearTimeout(handle);
				handle = null;
			}
		}
	};
}

/**
 * Debounced, sequence-guarded lookup. `schedule(query)` clears any pending
 * timer, bumps a monotonic counter, and arms a timer that invokes
 * `run(query, () => seq === currentSeq)`. `cancel()` clears the pending timer
 * and bumps the counter so any in-flight `isCurrent()` reads false.
 */
export function createDebouncedLookup<T>(
	run: (query: T, isCurrent: () => boolean) => void | Promise<void>,
	delayMs = 150
): { schedule(query: T): void; cancel(): void } {
	let handle: ReturnType<typeof setTimeout> | null = null;
	let seq = 0;
	return {
		schedule(query: T) {
			if (handle) clearTimeout(handle);
			const current = ++seq;
			handle = setTimeout(() => {
				handle = null;
				run(query, () => current === seq);
			}, delayMs);
		},
		cancel() {
			if (handle) {
				clearTimeout(handle);
				handle = null;
			}
			seq++;
		}
	};
}
