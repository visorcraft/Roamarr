// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// @ts-ignore — internal Svelte client runtime, used by the inline DOM test helper
import { mount, unmount } from '../../../node_modules/svelte/src/internal/client/render.js';
// @ts-ignore — internal Svelte client runtime
import { flushSync } from '../../../node_modules/svelte/src/internal/client/reactivity/batch.js';
import GlobeModal from './GlobeModal.svelte';

// Force the bare `svelte` specifier to its client build. Vitest runs under the
// node condition, which otherwise resolves `svelte` to index-server.js and makes
// onMount/onDestroy throw (no SSR context) in this jsdom mount harness.
// @ts-ignore — internal Svelte client runtime
vi.mock('svelte', async () => await import('../../../node_modules/svelte/src/index-client.js'));

const { created, disposed, selectUnsubs, createMock, GlobeClass } = vi.hoisted(() => {
	const created: FakeGlobe[] = [];
	const disposed: FakeGlobe[] = [];
	const selectUnsubs: Array<() => void> = [];
	class FakeGlobe {
		constructor() {
			created.push(this);
		}
		setCities() {}
		flyTo() {}
		on() {
			const u = vi.fn();
			selectUnsubs.push(u);
			return u;
		}
		dispose() {
			disposed.push(this);
		}
	}
	const createMock = vi.fn().mockImplementation(() => Promise.resolve(new FakeGlobe()));
	return { created, disposed, selectUnsubs, createMock, GlobeClass: FakeGlobe };
});

// The component gates mount work on `$app/environment` browser. Vitest loads
// the kit virtual module under the SSR transform, which makes `browser` false;
// force it true so the client teardown paths under test actually run.
vi.mock('$app/environment', () => ({ browser: true, dev: false, building: false, version: '0.0.0' }));
vi.mock('$lib/EarthCityGlobe.js', () => ({ EarthCityGlobe: { create: createMock } }));

type FakeGlobe = InstanceType<typeof GlobeClass>;

const flush = () => new Promise((r) => setTimeout(r, 0));

function mountModal(props: Record<string, unknown>) {
	const app = mount(GlobeModal, { target: document.body, props });
	flushSync();
	return app;
}

beforeEach(() => {
	created.length = 0;
	disposed.length = 0;
	selectUnsubs.length = 0;
	createMock.mockReset().mockImplementation(() => Promise.resolve(new GlobeClass()));
	// jsdom does not implement <dialog>.showModal/close; stub no-ops that keep
	// the .open flag in sync so the component's open/close effect can run.
	HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
		this.open = true;
	}) as unknown as () => void;
	HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
		this.open = false;
	}) as unknown as () => void;
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
});

afterEach(() => {
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

describe('GlobeModal teardown', () => {
	it('disposes the globe and unsubscribes the select listener on destroy', async () => {
		const app = mountModal({ open: true, lat: 1, lng: 2, cityName: 'Cairo' });
		await flush(); // let import + create() resolve and wire up
		expect(created.length).toBe(1);
		expect(selectUnsubs.length).toBe(1);

		unmount(app);
		flushSync();

		expect(disposed).toContain(created[0]);
		expect(selectUnsubs[0]).toHaveBeenCalledOnce();
	});

	it('disposes a globe that finishes creating after the component is gone', async () => {
		let resolveCreate!: (g: FakeGlobe) => void;
		createMock.mockImplementationOnce(
			() => new Promise<FakeGlobe>((resolve) => (resolveCreate = resolve))
		);

		const app = mountModal({ open: true, lat: 1, lng: 2, cityName: 'Cairo' });
		// Let the module import resolve and create() get invoked; create() is now
		// pending and no instance has been constructed yet.
		await flush();
		expect(created.length).toBe(0);

		// Destroy while create() is still pending (SPA navigation).
		unmount(app);
		flushSync();

		const late = new GlobeClass();
		resolveCreate(late);
		await flush();

		expect(disposed).toContain(late);
		// Wiring (the select subscription) must be skipped for the late instance.
		expect(selectUnsubs.length).toBe(0);
	});
});
