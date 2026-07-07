import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { POST } from './+server';
import { makeFareProvider, makeAdmin } from '../../../../../../tests/helpers';
import { makeUserLocals } from '../../../../../../tests/eventHelpers';
import { resetRateLimit } from '$lib/server/rateLimit';

beforeEach(() => {
	resetRateLimit();
});

function makeEvent(params: Record<string, string>, user: unknown) {
	return {
		params,
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('test returns the stub result for an owned provider', async () => {
	const admin = makeAdmin(ctx.kit, { email: 'admin@x.c' });
	const p = makeFareProvider(ctx.kit, admin.id, { providerKey: 'stub', label: 'Test', apiKey: null });

	const res = await POST(makeEvent({ id: String(p.id) }, admin));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.ok).toBe(true);
	expect(body.summary).toContain('stub provider');
});

test('test rejects another admins provider', async () => {
	const owner = makeAdmin(ctx.kit, { email: 'admin-owner@x.c' });
	const other = makeAdmin(ctx.kit, { email: 'admin-other@x.c' });
	const p = makeFareProvider(ctx.kit, owner.id, { providerKey: 'stub', label: 'X' });

	await expect(POST(makeEvent({ id: String(p.id) }, other))).rejects.toMatchObject({ status: 404 });
});

test('test rejects invalid id', async () => {
	const admin = makeAdmin(ctx.kit, { email: 'admin-invalid@x.c' });
	await expect(POST(makeEvent({ id: 'abc' }, admin))).rejects.toMatchObject({ status: 400 });
});

test('test rejects unauthenticated requests', async () => {
	await expect(POST(makeEvent({ id: '1' }, null))).rejects.toMatchObject({ status: 401 });
});

test('test rejects non-admin requests', async () => {
	const user = makeUserLocals(ctx.kit);
	const p = makeFareProvider(ctx.kit, user.user.id, { providerKey: 'stub', label: 'X' });
	await expect(POST(makeEvent({ id: String(p.id) }, user.user))).rejects.toMatchObject({ status: 403 });
});
