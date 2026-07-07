import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { makeFareProvider, makeAdmin } from '../../../../tests/helpers';
import { makeUserLocals } from '../../../../tests/eventHelpers';
import { encrypt } from '$lib/server/crypto';
import { resetRateLimit } from '$lib/server/rateLimit';

beforeEach(() => {
	resetRateLimit();
});

function makeEvent(url: string, user: unknown) {
	return {
		url: new URL(url, 'http://localhost'),
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('returns paginated fare providers without exposing api keys', async () => {
	const admin = makeAdmin(ctx.kit, { email: 'admin@x.c' });
	const p1 = makeFareProvider(ctx.kit, admin.id, {
		providerKey: 'amadeus',
		label: 'Amadeus',
		apiKey: encrypt('secret-key')
	});
	const p2 = makeFareProvider(ctx.kit, admin.id, {
		providerKey: 'stub',
		label: 'Stub Provider',
		enabled: false,
		apiKey: null
	});

	const res = await GET(makeEvent('/api/fare-providers', admin));
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

test('does not expose other admins fare providers', async () => {
	const adminA = makeAdmin(ctx.kit, { email: 'admin-a@x.c' });
	const adminB = makeAdmin(ctx.kit, { email: 'admin-b@x.c' });
	makeFareProvider(ctx.kit, adminA.id, { providerKey: 'amadeus', label: 'Amadeus' });

	const res = await GET(makeEvent('/api/fare-providers', adminB));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(0);
	expect(body.rows).toEqual([]);
});

test('rejects unauthenticated requests', async () => {
	await expect(GET(makeEvent('/api/fare-providers', null))).rejects.toMatchObject({ status: 401 });
});

test('rejects non-admin requests', async () => {
	const user = makeUserLocals(ctx.kit);
	await expect(GET(makeEvent('/api/fare-providers', user.user))).rejects.toMatchObject({ status: 403 });
});
