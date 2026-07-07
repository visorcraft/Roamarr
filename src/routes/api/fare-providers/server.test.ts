import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { makeUser, makeFareProvider } from '../../../../tests/helpers';
import { encrypt } from '$lib/server/crypto';

function makeEvent(url: string, user: unknown) {
	return {
		url: new URL(url, 'http://localhost'),
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('returns paginated fare providers without exposing api keys', async () => {
	const user = makeUser(ctx.kit);
	const p1 = makeFareProvider(ctx.kit, user.id, {
		providerKey: 'amadeus',
		label: 'Amadeus',
		apiKey: encrypt('secret-key')
	});
	const p2 = makeFareProvider(ctx.kit, user.id, {
		providerKey: 'stub',
		label: 'Stub Provider',
		enabled: false,
		apiKey: null
	});

	const res = await GET(makeEvent('/api/fare-providers', user));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(2);
	expect(body.rows).toHaveLength(2);
	expect(body.rows).toContainEqual(
		expect.objectContaining({
			id: p1.id,
			providerKey: 'amadeus',
			label: 'Amadeus',
			enabled: true,
			hasKey: true
		})
	);
	expect(body.rows).toContainEqual(
		expect.objectContaining({
			id: p2.id,
			providerKey: 'stub',
			label: 'Stub Provider',
			enabled: false,
			hasKey: false
		})
	);
	for (const row of body.rows) {
		expect(row).not.toHaveProperty('apiKey');
	}
});
