import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	comboboxOptionId,
	isImeCompositionEvent,
	resolveComboboxKeydown,
	createBlurCloseTimer,
	createDebouncedLookup
} from './combobox';

function ev(key: string, extra: { isComposing?: boolean; keyCode?: number } = {}) {
	return { key, isComposing: extra.isComposing ?? false, keyCode: extra.keyCode ?? 0 };
}

describe('comboboxOptionId', () => {
	it('builds the option id from name and index', () => {
		expect(comboboxOptionId('city', 0)).toBe('city-option-0');
		expect(comboboxOptionId('city', 12)).toBe('city-option-12');
		expect(comboboxOptionId('my-field', 3)).toBe('my-field-option-3');
	});
});

describe('isImeCompositionEvent', () => {
	it('is true when isComposing is set', () => {
		expect(isImeCompositionEvent({ isComposing: true, keyCode: 13 })).toBe(true);
	});

	it('is true for keyCode 229 even when isComposing is false (Safari Enter commit)', () => {
		expect(isImeCompositionEvent({ isComposing: false, keyCode: 229 })).toBe(true);
	});

	it('is false for normal keys', () => {
		expect(isImeCompositionEvent({ isComposing: false, keyCode: 13 })).toBe(false);
		expect(isImeCompositionEvent({ isComposing: false, keyCode: 40 })).toBe(false);
		expect(isImeCompositionEvent({ isComposing: false, keyCode: 0 })).toBe(false);
	});
});

describe('resolveComboboxKeydown', () => {
	it('ignores events that belong to an IME composition', () => {
		expect(
			resolveComboboxKeydown(ev('ArrowDown', { isComposing: true }), { open: true, activeIndex: 0, count: 3 })
		).toEqual({ kind: 'ignore' });
		expect(
			resolveComboboxKeydown(ev('Enter', { keyCode: 229 }), { open: true, activeIndex: 1, count: 3 })
		).toEqual({ kind: 'ignore' });
	});

	it('ignores Escape when count is 0 and the list is closed', () => {
		expect(
			resolveComboboxKeydown(ev('Escape'), { open: false, activeIndex: -1, count: 0 })
		).toEqual({ kind: 'ignore' });
	});

	it('closes an empty open list on Escape without preventing default or moving activeIndex', () => {
		expect(
			resolveComboboxKeydown(ev('Escape'), { open: true, activeIndex: 2, count: 0 })
		).toEqual({ kind: 'update', open: false, activeIndex: 2, preventDefault: false });
		expect(
			resolveComboboxKeydown(ev('Escape'), { open: true, activeIndex: -1, count: 0 })
		).toEqual({ kind: 'update', open: false, activeIndex: -1, preventDefault: false });
	});

	it('ignores every key when count is 0 other than Escape', () => {
		for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'a', 'Tab']) {
			expect(
				resolveComboboxKeydown(ev(key), { open: true, activeIndex: 1, count: 0 })
			).toEqual({ kind: 'ignore' });
		}
	});

	it('ArrowDown opens the list and selects the first option when closed', () => {
		expect(
			resolveComboboxKeydown(ev('ArrowDown'), { open: false, activeIndex: -1, count: 3 })
		).toEqual({ kind: 'update', open: true, activeIndex: 0, preventDefault: true });
	});

	it('ArrowDown advances the active option and wraps at the end', () => {
		expect(
			resolveComboboxKeydown(ev('ArrowDown'), { open: true, activeIndex: 0, count: 3 })
		).toEqual({ kind: 'update', open: true, activeIndex: 1, preventDefault: true });
		expect(
			resolveComboboxKeydown(ev('ArrowDown'), { open: true, activeIndex: 2, count: 3 })
		).toEqual({ kind: 'update', open: true, activeIndex: 0, preventDefault: true });
	});

	it('ArrowUp opens the list and selects the last option when closed', () => {
		expect(
			resolveComboboxKeydown(ev('ArrowUp'), { open: false, activeIndex: -1, count: 3 })
		).toEqual({ kind: 'update', open: true, activeIndex: 2, preventDefault: true });
	});

	it('ArrowUp moves the active option back and wraps at the start', () => {
		expect(
			resolveComboboxKeydown(ev('ArrowUp'), { open: true, activeIndex: 2, count: 3 })
		).toEqual({ kind: 'update', open: true, activeIndex: 1, preventDefault: true });
		expect(
			resolveComboboxKeydown(ev('ArrowUp'), { open: true, activeIndex: 0, count: 3 })
		).toEqual({ kind: 'update', open: true, activeIndex: 2, preventDefault: true });
	});

	it('Home jumps to the first option only when open', () => {
		expect(
			resolveComboboxKeydown(ev('Home'), { open: true, activeIndex: 2, count: 3 })
		).toEqual({ kind: 'update', open: true, activeIndex: 0, preventDefault: true });
		expect(
			resolveComboboxKeydown(ev('Home'), { open: false, activeIndex: -1, count: 3 })
		).toEqual({ kind: 'ignore' });
	});

	it('End jumps to the last option only when open', () => {
		expect(
			resolveComboboxKeydown(ev('End'), { open: true, activeIndex: 0, count: 3 })
		).toEqual({ kind: 'update', open: true, activeIndex: 2, preventDefault: true });
		expect(
			resolveComboboxKeydown(ev('End'), { open: false, activeIndex: -1, count: 3 })
		).toEqual({ kind: 'ignore' });
	});

	it('Enter selects the active option when open and activeIndex >= 0', () => {
		expect(
			resolveComboboxKeydown(ev('Enter'), { open: true, activeIndex: 1, count: 3 })
		).toEqual({ kind: 'select', index: 1, preventDefault: true });
		expect(
			resolveComboboxKeydown(ev('Enter'), { open: true, activeIndex: 0, count: 1 })
		).toEqual({ kind: 'select', index: 0, preventDefault: true });
	});

	it('Enter is ignored when closed or activeIndex is negative', () => {
		expect(
			resolveComboboxKeydown(ev('Enter'), { open: false, activeIndex: 0, count: 3 })
		).toEqual({ kind: 'ignore' });
		expect(
			resolveComboboxKeydown(ev('Enter'), { open: true, activeIndex: -1, count: 3 })
		).toEqual({ kind: 'ignore' });
	});

	it('Escape closes the list and resets activeIndex when open', () => {
		expect(
			resolveComboboxKeydown(ev('Escape'), { open: true, activeIndex: 2, count: 3 })
		).toEqual({ kind: 'update', open: false, activeIndex: -1, preventDefault: true });
	});

	it('Escape is ignored when closed', () => {
		expect(
			resolveComboboxKeydown(ev('Escape'), { open: false, activeIndex: -1, count: 3 })
		).toEqual({ kind: 'ignore' });
	});

	it('ignores unrelated keys', () => {
		for (const key of ['a', 'Tab', 'PageDown', ' ']) {
			expect(
				resolveComboboxKeydown(ev(key), { open: true, activeIndex: 0, count: 3 })
			).toEqual({ kind: 'ignore' });
		}
	});
});

describe('createBlurCloseTimer', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('does not create a timer at construction time', () => {
		const onClose = vi.fn();
		createBlurCloseTimer(onClose, 150);
		vi.advanceTimersByTime(1000);
		expect(onClose).not.toHaveBeenCalled();
	});

	it('fires onClose after the delay', () => {
		const onClose = vi.fn();
		const timer = createBlurCloseTimer(onClose, 150);
		timer.schedule();
		expect(onClose).not.toHaveBeenCalled();
		vi.advanceTimersByTime(150);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('fires after the default 150ms delay', () => {
		const onClose = vi.fn();
		const timer = createBlurCloseTimer(onClose);
		timer.schedule();
		vi.advanceTimersByTime(150);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('cancel prevents the timer from firing', () => {
		const onClose = vi.fn();
		const timer = createBlurCloseTimer(onClose, 150);
		timer.schedule();
		timer.cancel();
		vi.advanceTimersByTime(1000);
		expect(onClose).not.toHaveBeenCalled();
	});

	it('re-scheduling resets the delay', () => {
		const onClose = vi.fn();
		const timer = createBlurCloseTimer(onClose, 150);
		timer.schedule();
		vi.advanceTimersByTime(100);
		timer.schedule();
		vi.advanceTimersByTime(100);
		expect(onClose).not.toHaveBeenCalled();
		vi.advanceTimersByTime(50);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('clears the handle before invoking onClose so re-scheduling works', () => {
		const onClose = vi.fn();
		const timer = createBlurCloseTimer(onClose, 150);
		timer.schedule();
		vi.advanceTimersByTime(150);
		expect(onClose).toHaveBeenCalledTimes(1);
		timer.schedule();
		vi.advanceTimersByTime(150);
		expect(onClose).toHaveBeenCalledTimes(2);
	});
});

describe('createDebouncedLookup', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('debounces rapid calls into a single run', () => {
		const calls: string[] = [];
		const lookup = createDebouncedLookup<string>((query) => {
			calls.push(query);
		}, 150);
		lookup.schedule('a');
		lookup.schedule('b');
		lookup.schedule('c');
		vi.advanceTimersByTime(150);
		expect(calls).toEqual(['c']);
	});

	it('does not run before the delay elapses', () => {
		const calls: string[] = [];
		const lookup = createDebouncedLookup<string>((query) => {
			calls.push(query);
		}, 150);
		lookup.schedule('a');
		vi.advanceTimersByTime(149);
		expect(calls).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(calls).toEqual(['a']);
	});

	it('cancel clears the pending timer so run never fires', () => {
		const calls: string[] = [];
		const lookup = createDebouncedLookup<string>((query) => {
			calls.push(query);
		}, 150);
		lookup.schedule('a');
		lookup.cancel();
		vi.advanceTimersByTime(1000);
		expect(calls).toEqual([]);
	});

	it('cancel invalidates an in-flight isCurrent()', () => {
		let isCurrentFn: (() => boolean) | null = null;
		const lookup = createDebouncedLookup<string>((_query, isCurrent) => {
			isCurrentFn = isCurrent;
		}, 150);
		lookup.schedule('a');
		vi.advanceTimersByTime(150);
		expect(isCurrentFn).not.toBeNull();
		expect(isCurrentFn!()).toBe(true);
		lookup.cancel();
		expect(isCurrentFn!()).toBe(false);
	});

	it('a subsequent schedule invalidates an in-flight isCurrent()', () => {
		const calls: string[] = [];
		let isCurrentFn: (() => boolean) | null = null;
		const lookup = createDebouncedLookup<string>((query, isCurrent) => {
			calls.push(query);
			isCurrentFn = isCurrent;
		}, 150);
		lookup.schedule('a');
		vi.advanceTimersByTime(150);
		expect(calls).toEqual(['a']);
		expect(isCurrentFn!()).toBe(true);
		lookup.schedule('b');
		expect(isCurrentFn!()).toBe(false);
		vi.advanceTimersByTime(150);
		expect(calls).toEqual(['a', 'b']);
	});

	it('isCurrent reflects the latest scheduled query after cancel and reschedule', () => {
		const isCurrentFns: Array<() => boolean> = [];
		const lookup = createDebouncedLookup<string>((_query, isCurrent) => {
			isCurrentFns.push(isCurrent);
		}, 150);
		lookup.schedule('a');
		vi.advanceTimersByTime(150);
		lookup.cancel();
		lookup.schedule('b');
		vi.advanceTimersByTime(150);
		expect(isCurrentFns).toHaveLength(2);
		expect(isCurrentFns[0]()).toBe(false);
		expect(isCurrentFns[1]()).toBe(true);
	});
});
