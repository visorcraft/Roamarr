// @vitest-environment jsdom
import { test, expect, vi, afterEach } from 'vitest';
import { createRawSnippet } from 'svelte';
// @ts-ignore — internal Svelte client runtime, as in the other DOM tests
import { mount, unmount } from '../../node_modules/svelte/src/internal/client/render.js';
// @ts-ignore — internal Svelte client runtime
import { flushSync } from '../../node_modules/svelte/src/internal/client/reactivity/batch.js';

// A reactive stand-in for $app/state's page, so the test can "navigate" like the client router.
const page = vi.hoisted(() => ({ current: null as null | Record<string, any> }));

vi.mock('$app/state', () => ({
	get page() {
		return page.current;
	},
	navigating: { to: null, from: null, type: null },
	updated: { current: false }
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
// Under vitest `svelte` resolves to its server build, whose lifecycle functions (setContext,
// onDestroy) throw during a client mount. This test mounts on the client, so use the client build.
// @ts-ignore — internal Svelte client entry
vi.mock('svelte', () => import('../../node_modules/svelte/src/index-client.js'));

import Layout from './+layout.svelte';

const child = createRawSnippet(() => ({ render: () => '<p>child</p>' }));

const baseData = {
	user: null,
	appName: 'Roamarr',
	appVersion: '0.0.0',
	themeId: 'system',
	themeColor: '#0a0e1a',
	instanceName: 'Family Trips',
	allowRegistration: false,
	allowUserMcpClients: false,
	dateFormat: 'yyyy-MM-dd',
	datetimeFormat: 'yyyy-MM-dd h:mm a',
	timeFormat: '24h',
	unreadCount: 0
};

let app: unknown;

afterEach(() => {
	if (app) unmount(app);
	app = undefined;
	document.head.innerHTML = '';
	document.body.innerHTML = '';
	document.title = '';
});

function setup() {
	const state = $state({
		route: { id: '/trips' as string | null },
		url: new URL('http://localhost/trips'),
		data: {} as Record<string, unknown>,
		params: {},
		status: 200,
		error: null,
		form: null
	});
	page.current = state;
	const props = $state({ data: { ...baseData } as Record<string, unknown>, children: child });
	app = mount(Layout, { target: document.body, props });
	flushSync();
	return { state, props };
}

function navigate(state: Record<string, any>, id: string, data: Record<string, unknown> = {}) {
	state.route = { id };
	state.url = new URL(`http://localhost${id.replace(/\[\w+\]/g, '1')}`);
	state.data = data;
	flushSync();
}

test('document.title follows client-side navigation, including back to an untitled route', () => {
	const { state } = setup();
	expect(document.title).toBe('Trips · Family Trips');

	navigate(state, '/trips/[id]/print', { trip: { name: 'Lisbon 2027' } });
	expect(document.title).toBe('Lisbon 2027 — Printable Itinerary · Family Trips');

	navigate(state, '/no-such-route');
	expect(document.title).toBe('Family Trips');
});

test('the title follows a data change on the same route (another trip, same route id)', () => {
	const { state } = setup();
	navigate(state, '/trips/[id]', { trip: { name: 'Lisbon 2027' } });
	expect(document.title).toBe('Lisbon 2027 · Family Trips');
	navigate(state, '/trips/[id]', { trip: { name: 'Porto 2028' } });
	expect(document.title).toBe('Porto 2028 · Family Trips');
});

test('renaming the instance keeps the page name (the edge case from the #13 review)', () => {
	const { state, props } = setup();
	navigate(state, '/profile/api-keys');
	props.data = { ...props.data, instanceName: 'Our Travels' };
	flushSync();
	expect(document.title).toBe('API Keys · Our Travels');
});
