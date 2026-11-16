import { test, expect, vi, beforeEach } from 'vitest';
import { render } from 'svelte/server';
import { createRawSnippet } from 'svelte';

const page = vi.hoisted(() => ({
	route: { id: '/trips' as string | null },
	url: new URL('http://localhost/trips'),
	data: {} as Record<string, unknown>,
	params: {},
	status: 200,
	error: null as { message: string } | null,
	form: null
}));

vi.mock('$app/state', () => ({
	page,
	navigating: { to: null, from: null, type: null },
	updated: { current: false }
}));

import Layout from './+layout.svelte';

const child = createRawSnippet(() => ({ render: () => '<p>child</p>' }));

const data = {
	user: null,
	appName: 'Roamarr',
	appVersion: '0.0.0',
	themeId: 'system',
	themeColor: '#0a0e1a',
	instanceName: 'Roamarr',
	allowRegistration: false,
	allowUserMcpClients: false,
	dateFormat: 'yyyy-MM-dd',
	datetimeFormat: 'yyyy-MM-dd h:mm a',
	timeFormat: '24h',
	unreadCount: 0
};

function titles(instanceName: string | null | undefined, routeId: string | null, pageData: Record<string, unknown> = {}) {
	page.route.id = routeId;
	page.data = pageData;
	const { head } = render(Layout, { props: { data: { ...data, instanceName }, children: child } as never });
	return [...head.matchAll(/<title>(.*?)<\/title>/g)].map((m) => m[1]);
}

beforeEach(() => {
	page.route.id = '/trips';
	page.data = {};
	page.error = null;
});

test('a listed route gets "Page name · instance name" as its only title', () => {
	expect(titles('Family Trips', '/trips')).toEqual(['Trips · Family Trips']);
	expect(titles('Family Trips', '/profile/api-keys')).toEqual(['API Keys · Family Trips']);
});

test('the instance name falls back to Roamarr when unset, null or empty', () => {
	expect(titles(undefined, '/trips')).toEqual(['Trips · Roamarr']);
	expect(titles(null, '/trips')).toEqual(['Trips · Roamarr']);
	expect(titles('', '/trips')).toEqual(['Trips · Roamarr']);
});

test('a route without a page name (or no route, as on the error page) gets the bare instance name', () => {
	expect(titles('Family Trips', '/no-such-route')).toEqual(['Family Trips']);
	expect(titles('Family Trips', null)).toEqual(['Family Trips']);
	expect(titles(undefined, null)).toEqual(['Roamarr']);
});

test('trip pages lead with the trip name from the page data', () => {
	const trip = { trip: { name: 'Lisbon 2027' } };
	expect(titles('Family Trips', '/trips/[id]', trip)).toEqual(['Lisbon 2027 · Family Trips']);
	expect(titles('Family Trips', '/share/[token]', trip)).toEqual(['Lisbon 2027 · Family Trips']);
});

test('trip pages fall back to a generic name when the trip has no usable name', () => {
	expect(titles('Family Trips', '/trips/[id]', {})).toEqual(['Trip · Family Trips']);
	expect(titles('Family Trips', '/trips/[id]', { trip: { name: '  ' } })).toEqual(['Trip · Family Trips']);
	expect(titles('Family Trips', '/share/[token]', {})).toEqual(['Shared trip · Family Trips']);
});

test('the print page title is the page name alone (the default "Save as PDF" filename)', () => {
	expect(titles('Family Trips', '/trips/[id]/print', { trip: { name: 'Lisbon 2027' } })).toEqual([
		'Lisbon 2027 — Printable Itinerary'
	]);
	expect(titles('Family Trips', '/trips/[id]/print', {})).toEqual(['Printable Itinerary']);
});

test('a load error on a listed route gets the bare instance name, not the route title', () => {
	page.error = { message: 'Not Found' };
	expect(titles('Family Trips', '/share/[token]')).toEqual(['Family Trips']);
	expect(titles('Family Trips', '/trips/[id]/print')).toEqual(['Family Trips']);
	expect(titles(undefined, '/trips')).toEqual(['Roamarr']);
});

test('/general names the configuration tab it shows (legacy ?tab= links)', () => {
	expect(titles('Family Trips', '/general', { tab: 'general' })).toEqual(['Configuration · Family Trips']);
	expect(titles('Family Trips', '/general', { tab: 'maps' })).toEqual(['Maps · Family Trips']);
	expect(titles('Family Trips', '/general', { tab: 'bogus' })).toEqual(['Configuration · Family Trips']);
});

test('markup in a trip name or the instance name is escaped, not rendered', () => {
	expect(titles('<b>x</b>', '/trips/[id]', { trip: { name: '</title><script>' } })).toEqual([
		'&lt;/title>&lt;script> · &lt;b>x&lt;/b>'
	]);
});
