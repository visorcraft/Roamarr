import { test, expect, vi } from 'vitest';
import { render } from 'svelte/server';
import { createRawSnippet } from 'svelte';

vi.mock('$app/state', () => ({
	page: {
		route: { id: '/trips' },
		url: new URL('http://localhost/trips'),
		data: {},
		params: {},
		status: 200,
		error: null,
		form: null
	},
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

function titles(instanceName: string | null | undefined) {
	const { head } = render(Layout, { props: { data: { ...data, instanceName }, children: child } as never });
	return [...head.matchAll(/<title>(.*?)<\/title>/g)].map((m) => m[1]);
}

test('root layout uses the instance name as the default page title', () => {
	expect(titles('Family Trips')).toEqual(['Family Trips']);
});

test('root layout title falls back to Roamarr when the instance name is unset', () => {
	expect(titles(undefined)).toEqual(['Roamarr']);
	expect(titles(null)).toEqual(['Roamarr']);
	expect(titles('')).toEqual(['Roamarr']);
});
