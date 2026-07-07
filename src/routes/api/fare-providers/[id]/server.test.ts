import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { DELETE } from './+server';
import { makeFareProvider, makeAdmin } from '../../../../../tests/helpers';
import { makeUserLocals } from '../../../../../tests/eventHelpers';
import { fareProviders, auditLogs } from '$lib/server/db/mongrelSchema';
import { kit } from '$lib/server/db';
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

test('delete removes an owned provider, logs audit, and returns 204', async () => {
	const admin = makeAdmin(ctx.kit, { email: 'admin@x.c' });
	const p = makeFareProvider(ctx.kit, admin.id, { providerKey: 'stub', label: 'X' });

	const res = await DELETE(makeEvent({ id: String(p.id) }, admin));
	expect(res.status).toBe(204);

	const rows = kit.selectFrom(fareProviders).executeSync();
	expect(rows).toHaveLength(0);

	const logs = kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('fare_provider_delete');
	expect(logs[0].entity_type).toBe('fare_provider');
	expect(Number(logs[0].entity_id)).toBe(p.id);
});

test('delete rejects another admins provider', async () => {
	const owner = makeAdmin(ctx.kit, { email: 'admin-owner@x.c' });
	const other = makeAdmin(ctx.kit, { email: 'admin-other@x.c' });
	const p = makeFareProvider(ctx.kit, owner.id, { providerKey: 'stub', label: 'X' });

	await expect(DELETE(makeEvent({ id: String(p.id) }, other))).rejects.toMatchObject({ status: 404 });
});

test('delete rejects invalid id', async () => {
	const admin = makeAdmin(ctx.kit, { email: 'admin-invalid@x.c' });
	await expect(DELETE(makeEvent({ id: 'abc' }, admin))).rejects.toMatchObject({ status: 400 });
});

test('delete rejects unauthenticated requests', async () => {
	await expect(DELETE(makeEvent({ id: '1' }, null))).rejects.toMatchObject({ status: 401 });
});

test('delete rejects non-admin requests', async () => {
	const user = makeUserLocals(ctx.kit);
	const p = makeFareProvider(ctx.kit, user.user.id, { providerKey: 'stub', label: 'X' });
	await expect(DELETE(makeEvent({ id: String(p.id) }, user.user))).rejects.toMatchObject({ status: 403 });
});
