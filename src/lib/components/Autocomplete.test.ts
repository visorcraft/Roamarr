// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// @ts-ignore — internal Svelte client runtime, used by the inline DOM test helper
import { mount, unmount } from '../../../node_modules/svelte/src/internal/client/render.js';
// @ts-ignore — internal Svelte client runtime
import { flushSync } from '../../../node_modules/svelte/src/internal/client/reactivity/batch.js';
import Autocomplete from './Autocomplete.svelte';

type Suggestion = { id: number; label: string };
type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e?: unknown) => void };

function deferred<T>(): Deferred<T> {
	let resolve!: (v: T) => void;
	let reject!: (e?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('Autocomplete', () => {
	const mounted: unknown[] = [];
	const calls: Array<{ q: string; d: Deferred<Suggestion[]> }> = [];

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		calls.length = 0;
	});

	afterEach(() => {
		vi.useRealTimers();
		for (const app of mounted) unmount(app);
		mounted.length = 0;
		document.body.innerHTML = '';
	});

	const scrollIntoView = vi.fn();
	beforeEach(() => {
		Element.prototype.scrollIntoView = scrollIntoView;
	});
	afterEach(() => {
		vi.restoreAllMocks();
		delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
	});

	function fetchSuggestions(q: string): Promise<Suggestion[]> {
		const d = deferred<Suggestion[]>();
		calls.push({ q, d });
		return d.promise;
	}

	function mountAutocomplete(extra: Record<string, unknown> = {}) {
		const app = mount(Autocomplete, {
			target: document.body,
			props: { name: 'city', label: 'City', value: '', valueId: null, fetchSuggestions, ...extra }
		});
		flushSync();
		mounted.push(app);
		return app;
	}

	function getInput(): HTMLInputElement {
		const el = document.querySelector('input[type="text"]');
		if (!el) throw new Error('text input not found');
		return el as HTMLInputElement;
	}

	function type(value: string) {
		const input = getInput();
		input.value = value;
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}

	async function flushLookup() {
		await vi.advanceTimersByTimeAsync(0);
		flushSync();
	}

	function listbox() {
		return document.querySelector('[role="listbox"]');
	}

	it('keeps the newest result when an older lookup resolves last', async () => {
		mountAutocomplete();
		type('pa');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		type('par');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		expect(calls.map((c) => c.q)).toEqual(['pa', 'par']);

		calls[1].d.resolve([{ id: 2, label: 'Paris' }]);
		await flushLookup();
		expect(listbox()?.textContent).toContain('Paris');

		calls[0].d.resolve([{ id: 1, label: 'Palma' }]);
		await flushLookup();
		expect(listbox()?.textContent).toContain('Paris');
		expect(listbox()?.textContent).not.toContain('Palma');
	});

	it('a stale failure does not clear a newer result set', async () => {
		mountAutocomplete();
		type('pa');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		type('par');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		expect(calls.map((c) => c.q)).toEqual(['pa', 'par']);

		calls[1].d.resolve([{ id: 2, label: 'Paris' }]);
		await flushLookup();
		expect(listbox()?.textContent).toContain('Paris');

		calls[0].d.reject(new Error('stale'));
		await flushLookup();
		expect(listbox()?.textContent).toContain('Paris');
	});

	it('does not reopen the list when a lookup resolves after blur', async () => {
		mountAutocomplete();
		type('par');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		expect(calls).toHaveLength(1);

		getInput().dispatchEvent(new Event('blur'));
		await vi.advanceTimersByTimeAsync(150);
		flushSync();

		calls[0].d.resolve([{ id: 2, label: 'Paris' }]);
		await flushLookup();
		expect(listbox()).toBeNull();
		expect(getInput().getAttribute('aria-expanded')).toBe('false');
	});

	it('cancels a queued lookup when the input blurs before the debounce elapses', async () => {
		mountAutocomplete();
		type('par');

		getInput().dispatchEvent(new Event('blur'));
		await vi.advanceTimersByTimeAsync(500);
		flushSync();

		expect(calls).toHaveLength(0);
		expect(listbox()).toBeNull();
	});

	it('a lookup resolving after a selection does not reopen the list', async () => {
		mountAutocomplete();
		type('pa');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		expect(calls).toHaveLength(1);

		calls[0].d.resolve([{ id: 1, label: 'Palma' }]);
		await flushLookup();
		expect(listbox()?.textContent).toContain('Palma');

		type('pal');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		expect(calls).toHaveLength(2);

		const optionButton = Array.from(
			document.querySelectorAll<HTMLElement>('[role="option"] button')
		).find((b) => b.textContent?.trim() === 'Palma');
		expect(optionButton).toBeTruthy();
		optionButton!.click();
		flushSync();

		const hidden = document.querySelector('input[type="hidden"]') as HTMLInputElement;
		expect(hidden.value).toBe('1');
		expect(listbox()).toBeNull();

		calls[1].d.resolve([{ id: 3, label: 'Palermo' }]);
		await flushLookup();
		expect(listbox()).toBeNull();
	});

	it('wires aria-invalid and describedby when the field has an error', () => {
		mountAutocomplete({ errors: { city: 'Pick a city from the list.' } });
		const input = getInput();
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(input.getAttribute('aria-describedby')).toBe('city-error');
		expect(document.getElementById('city-error')?.textContent).toContain('Pick a city from the list.');
	});

	it('omits invalid/describedby without an error', () => {
		mountAutocomplete();
		const input = getInput();
		expect(input.getAttribute('aria-invalid')).toBeNull();
		expect(input.getAttribute('aria-describedby')).toBeNull();
	});

	it('an empty-string error renders no message or aria attributes', () => {
		mountAutocomplete({ errors: { city: '' } });
		const input = getInput();
		expect(input.getAttribute('aria-invalid')).toBeNull();
		expect(input.getAttribute('aria-describedby')).toBeNull();
		expect(document.getElementById('city-error')).toBeNull();
	});

	function keydown(key: string) {
		getInput().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
		flushSync();
	}

	function activeOptionId(): string | null {
		return getInput().getAttribute('aria-activedescendant');
	}

	function lastScrollTargetId(): string | undefined {
		const contexts = (scrollIntoView as { mock?: { instances?: unknown[] } }).mock?.instances;
		const last = contexts?.at(-1) as HTMLElement | undefined;
		return last?.id;
	}

	it('scrolls the active option into view as the highlight moves down', async () => {
		mountAutocomplete();
		type('par');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		calls[0].d.resolve([
			{ id: 1, label: 'Paris' },
			{ id: 2, label: 'Parma' },
			{ id: 3, label: 'Pisa' }
		]);
		await flushLookup();
		expect(listbox()).not.toBeNull();
		scrollIntoView.mockClear();

		keydown('ArrowDown');
		expect(activeOptionId()).toBe('city-option-1');
		expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
		expect(lastScrollTargetId()).toBe('city-option-1');

		keydown('ArrowDown');
		expect(activeOptionId()).toBe('city-option-2');
		expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
		expect(lastScrollTargetId()).toBe('city-option-2');
	});

	it('ArrowUp from the first option scrolls to the wrapped last option', async () => {
		mountAutocomplete();
		type('par');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		calls[0].d.resolve([
			{ id: 1, label: 'Paris' },
			{ id: 2, label: 'Parma' },
			{ id: 3, label: 'Pisa' }
		]);
		await flushLookup();
		scrollIntoView.mockClear();

		keydown('ArrowUp');
		expect(activeOptionId()).toBe('city-option-2');
		expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
		expect(lastScrollTargetId()).toBe('city-option-2');
	});

	it('End and Home move the scroll target', async () => {
		mountAutocomplete();
		type('par');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		calls[0].d.resolve([
			{ id: 1, label: 'Paris' },
			{ id: 2, label: 'Parma' },
			{ id: 3, label: 'Pisa' }
		]);
		await flushLookup();
		scrollIntoView.mockClear();

		keydown('End');
		expect(activeOptionId()).toBe('city-option-2');
		expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
		expect(lastScrollTargetId()).toBe('city-option-2');

		keydown('Home');
		expect(activeOptionId()).toBe('city-option-0');
		expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
		expect(lastScrollTargetId()).toBe('city-option-0');
	});

	it('does not scroll while the list is closed', async () => {
		mountAutocomplete();
		expect(scrollIntoView).not.toHaveBeenCalled();
		type('par');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		expect(scrollIntoView).not.toHaveBeenCalled();

		calls[0].d.resolve([
			{ id: 1, label: 'Paris' },
			{ id: 2, label: 'Parma' },
			{ id: 3, label: 'Pisa' }
		]);
		await flushLookup();
		expect(listbox()).not.toBeNull();
		const callsAfterOpen = scrollIntoView.mock.calls.length;
		expect(callsAfterOpen).toBeGreaterThan(0);

		keydown('Escape');
		expect(listbox()).toBeNull();
		expect(scrollIntoView.mock.calls.length).toBe(callsAfterOpen);
	});

	it('works when scrollIntoView is unavailable', async () => {
		delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
		mountAutocomplete();
		type('par');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		calls[0].d.resolve([
			{ id: 1, label: 'Paris' },
			{ id: 2, label: 'Parma' },
			{ id: 3, label: 'Pisa' }
		]);
		await flushLookup();
		expect(listbox()).not.toBeNull();

		keydown('ArrowDown');
		keydown('Enter');

		const hidden = document.querySelector('input[type="hidden"]') as HTMLInputElement;
		expect(hidden.value).toBe('2');
		expect(listbox()).toBeNull();
	});

	it('listbox uses the theme line token', async () => {
		mountAutocomplete();
		type('par');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		calls[0].d.resolve([{ id: 2, label: 'Paris' }]);
		await flushLookup();
		const box = listbox();
		expect(box).not.toBeNull();
		expect(box!.className).toContain('ring-[var(--theme-line)]');
		expect(box!.className).not.toContain('ring-white');
	});

	const status = () => document.querySelector('[role="status"]')?.textContent;

	it('shows the no-results message when a lookup returns no rows', async () => {
		mountAutocomplete();
		type('zzz');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		calls[0].d.resolve([]);
		await flushLookup();

		expect(listbox()).toBeNull();
		expect(status()).toBe('No matches');
		expect(document.querySelector('p[aria-hidden="true"]')?.textContent).toBe('No matches');
		expect(getInput().getAttribute('aria-expanded')).toBe('true');
		expect(getInput().getAttribute('aria-controls')).toBeNull();
		expect(getInput().getAttribute('aria-activedescendant')).toBeNull();
	});

	it('honours a custom noResultsText', async () => {
		mountAutocomplete({ noResultsText: 'Nothing found' });
		type('zzz');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		calls[0].d.resolve([]);
		await flushLookup();

		expect(status()).toBe('Nothing found');
	});

	it('no-results message uses the theme line token', async () => {
		mountAutocomplete();
		type('zzz');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		calls[0].d.resolve([]);
		await flushLookup();

		const message = document.querySelector('p[aria-hidden="true"]');
		expect(message).not.toBeNull();
		expect(message!.className).toContain('ring-[var(--theme-line)]');
		expect(message!.className).not.toContain('ring-white');
	});

	it('Escape dismisses the no-results message', async () => {
		mountAutocomplete();
		type('zzz');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		calls[0].d.resolve([]);
		await flushLookup();
		expect(status()).toBe('No matches');

		keydown('Escape');

		expect(status()).toBe('');
		expect(getInput().getAttribute('aria-expanded')).toBe('false');
	});

	it('Enter is not swallowed while the no-results message is shown', async () => {
		mountAutocomplete();
		type('zzz');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		calls[0].d.resolve([]);
		await flushLookup();

		const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
		getInput().dispatchEvent(event);
		flushSync();

		expect(event.defaultPrevented).toBe(false);
		expect(status()).toBe('No matches');
	});

	it('blur dismisses the no-results message', async () => {
		mountAutocomplete();
		type('zzz');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		calls[0].d.resolve([]);
		await flushLookup();
		expect(status()).toBe('No matches');

		getInput().dispatchEvent(new Event('blur'));
		await vi.advanceTimersByTimeAsync(150);
		flushSync();

		expect(status()).toBe('');
		expect(getInput().getAttribute('aria-expanded')).toBe('false');
	});

	it('does not scroll while the no-results message is shown', async () => {
		mountAutocomplete();
		type('zzz');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		calls[0].d.resolve([]);
		await flushLookup();

		expect(status()).toBe('No matches');
		expect(scrollIntoView).not.toHaveBeenCalled();
	});

	it('a stale empty lookup shows no message', async () => {
		mountAutocomplete();
		type('zzz');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		type('zz');

		calls[0].d.resolve([]);
		await flushLookup();

		expect(status()).toBe('');
	});

	it('a failed lookup shows no message', async () => {
		mountAutocomplete();
		type('zzz');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();

		calls[0].d.reject(new Error('boom'));
		await flushLookup();

		expect(status()).toBe('');
		expect(getInput().getAttribute('aria-expanded')).toBe('false');
		expect(listbox()).toBeNull();
	});

	it('a later lookup with rows replaces the no-results message', async () => {
		mountAutocomplete();
		type('zzz');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		calls[0].d.resolve([]);
		await flushLookup();
		expect(status()).toBe('No matches');

		type('pa');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		calls[1].d.resolve([{ id: 2, label: 'Paris' }]);
		await flushLookup();

		expect(listbox()).not.toBeNull();
		expect(status()).toBe('');
		expect(getInput().getAttribute('aria-controls')).toBe('city-listbox');
	});
});
