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

	function fetchSuggestions(q: string): Promise<Suggestion[]> {
		const d = deferred<Suggestion[]>();
		calls.push({ q, d });
		return d.promise;
	}

	function mountAutocomplete() {
		const app = mount(Autocomplete, {
			target: document.body,
			props: { name: 'city', label: 'City', value: '', valueId: null, fetchSuggestions }
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
});
