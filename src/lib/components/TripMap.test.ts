// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// @ts-ignore — internal Svelte client runtime, used by the inline DOM test helper
import { mount, unmount } from '../../../node_modules/svelte/src/internal/client/render.js';
// @ts-ignore — internal Svelte client runtime
import { flushSync } from '../../../node_modules/svelte/src/internal/client/reactivity/batch.js';
import TripMap from './TripMap.svelte';

// Force the bare `svelte` specifier to its client build. Vitest runs under the
// node condition, which otherwise resolves `svelte` to index-server.js and makes
// onMount/onDestroy throw (no SSR context) in this jsdom mount harness.
// @ts-ignore — internal Svelte client runtime
vi.mock('svelte', async () => await import('../../../node_modules/svelte/src/index-client.js'));

const { created, removed, markers, MapMock, MarkerMock } = vi.hoisted(() => {
	const created: MapMock[] = [];
	const removed: MapMock[] = [];
	const markers: unknown[] = [];
	class MapMock {
		constructor() {
			created.push(this);
		}
		remove() {
			removed.push(this);
		}
		setCenter() {}
	}
	class MarkerMock {
		setLngLat() {
			return this;
		}
		addTo(map: unknown) {
			markers.push(map);
			return this;
		}
	}
	return { created, removed, markers, MapMock, MarkerMock };
});

// The component gates mount work on `$app/environment` browser. Vitest loads
// the kit virtual module under the SSR transform, which makes `browser` false;
// force it true so the client teardown paths under test actually run.
vi.mock('$app/environment', () => ({ browser: true, dev: false, building: false, version: '0.0.0' }));
vi.mock('maplibre-gl', () => ({ default: { Map: MapMock, Marker: MarkerMock } }));
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

const baseProps = {
	lat: 1,
	lng: 2,
	cityName: 'Cairo',
	tileUrls: ['https://tiles/{z}/{x}/{y}'],
	attribution: 'x'
};
const flush = () => new Promise((r) => setTimeout(r, 0));

function mountMap(props: Record<string, unknown> = baseProps) {
	const app = mount(TripMap, { target: document.body, props });
	flushSync();
	return app;
}

beforeEach(() => {
	created.length = 0;
	removed.length = 0;
	markers.length = 0;
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('TripMap teardown', () => {
	it('removes the map on destroy after a normal mount', async () => {
		const app = mountMap();
		await flush(); // dynamic imports resolve; map constructed and wired
		expect(created.length).toBe(1);
		expect(removed.length).toBe(0);
		expect(markers.length).toBe(1);

		unmount(app);
		flushSync();

		expect(removed).toContain(created[0]);
	});

	it('removes the late-created map and skips wiring when unmounted before import resolves', async () => {
		const app = mountMap();
		// Destroy while the dynamic import('maplibre-gl') is still pending.
		unmount(app);
		flushSync();
		expect(removed.length).toBe(0);

		await flush(); // import resolves now, after destroy

		expect(created.length).toBe(1);
		expect(removed).toContain(created[0]);
		// No marker/source wiring for the torn-down instance.
		expect(markers.length).toBe(0);
	});
});
