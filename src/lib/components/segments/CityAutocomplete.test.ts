// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// @ts-ignore — internal Svelte client runtime, used by the inline DOM test helper
import { mount, unmount } from '../../../../node_modules/svelte/src/internal/client/render.js';
// @ts-ignore — internal Svelte client runtime
import { flushSync } from '../../../../node_modules/svelte/src/internal/client/reactivity/batch.js';
import CityAutocomplete from './CityAutocomplete.svelte';

type City = { name: string; lat: number; lng: number };
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

describe('CityAutocomplete', () => {
	const mounted: unknown[] = [];
	const calls: Array<{
		url: string;
		d: Deferred<{ ok: boolean; json: () => Promise<{ cities: City[] }> }>;
	}> = [];
	const fetchMock = vi.fn((url: string) => {
		const d = deferred<{ ok: boolean; json: () => Promise<{ cities: City[] }> }>();
		calls.push({ url, d });
		return d.promise;
	});

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		vi.stubGlobal('fetch', fetchMock);
		calls.length = 0;
		fetchMock.mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
		for (const app of mounted) unmount(app);
		mounted.length = 0;
		document.body.innerHTML = '';
	});

	function mountAutocomplete(extra: Record<string, unknown> = {}) {
		const app = mount(CityAutocomplete, {
			target: document.body,
			props: { countryCode: 'FR', name: 'city', value: '', latName: 'lat', lngName: 'lng', ...extra }
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

	function resolveWith(cities: City[]) {
		return { ok: true, json: async () => ({ cities }) };
	}

	it('keeps the newest result when an older lookup resolves last', async () => {
		mountAutocomplete();
		type('pa');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		type('par');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		expect(calls).toHaveLength(2);
		expect(calls[0].url).toContain('q=pa');
		expect(calls[1].url).toContain('q=par');

		calls[1].d.resolve(resolveWith([{ name: 'Paris', lat: 48.85, lng: 2.35 }]));
		await flushLookup();
		expect(listbox()?.textContent).toContain('Paris');

		calls[0].d.resolve(resolveWith([{ name: 'Palma', lat: 39.57, lng: -0.38 }]));
		await flushLookup();
		expect(listbox()?.textContent).toContain('Paris');
		expect(listbox()?.textContent).not.toContain('Palma');
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

		calls[0].d.resolve(resolveWith([{ name: 'Paris', lat: 48.85, lng: 2.35 }]));
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

		calls[0].d.resolve(resolveWith([{ name: 'Paris', lat: 48.85, lng: 2.35 }]));
		await flushLookup();
		expect(listbox()?.textContent).toContain('Paris');

		type('pal');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		expect(calls).toHaveLength(2);

		const optionButton = Array.from(
			document.querySelectorAll<HTMLElement>('[role="option"] button')
		).find((b) => b.textContent?.trim() === 'Paris');
		expect(optionButton).toBeTruthy();
		optionButton!.click();
		flushSync();

		const latInput = document.querySelector('#lat') as HTMLInputElement;
		expect(latInput.value).toBe('48.85');
		expect(listbox()).toBeNull();

		calls[1].d.resolve(resolveWith([{ name: 'Palermo', lat: 38.12, lng: 13.36 }]));
		await flushLookup();
		expect(listbox()).toBeNull();
	});

	it('wires aria-invalid and describedby when the field has an error', () => {
		mountAutocomplete({ errors: { city: 'Enter a city.' } });
		const input = getInput();
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(input.getAttribute('aria-describedby')).toBe('city-error');
		expect(document.getElementById('city-error')?.textContent).toContain('Enter a city.');
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

	it('listbox uses the theme line token', async () => {
		mountAutocomplete();
		type('par');
		await vi.advanceTimersByTimeAsync(150);
		flushSync();
		calls[0].d.resolve(resolveWith([{ name: 'Paris', lat: 48.85, lng: 2.35 }]));
		await flushLookup();
		const box = listbox();
		expect(box).not.toBeNull();
		expect(box!.className).toContain('ring-[var(--theme-line)]');
		expect(box!.className).not.toContain('ring-white');
	});
});
