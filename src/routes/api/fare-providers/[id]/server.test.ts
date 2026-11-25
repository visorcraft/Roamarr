import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { DELETE, PATCH } from './+server';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { decrypt, encrypt } from '$lib/server/crypto';
import { makeFareProvider, makeAdmin, makeUser } from '../../../../../tests/helpers';
import { makeUserLocals } from '../../../../../tests/eventHelpers';
import { fareProviders, auditLogs } from '$lib/server/db/mongrelSchema';
import { kit } from '$lib/server/db';
import { resetRateLimit } from '$lib/server/rateLimit';

beforeEach(() => {
	resetRateLimit();
});

function makeEvent(params: Record<string, string>, user: unknown, payload?: unknown) {
	return {
		params,
		locals: { user },
		getClientAddress: () => '127.0.0.1',
		request: {
			json: async () => {
				if (payload === undefined) throw new SyntaxError('Unexpected end of JSON input');
				return payload;
			}
		}
	} as any;
}

function readProvider(id: number) {
	return kit.selectFrom(fareProviders).where(kitEq(fareProviders.id, BigInt(id))).executeSync()[0]!;
}

function countUpdateAudit(id: number) {
	return kit
		.selectFrom(auditLogs)
		.executeSync()
		.filter((r) => r.action === 'fare_provider_update' && Number(r.entity_id) === id).length;
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

test('patch renames only and keeps the provider enabled', async () => {
	const admin = makeAdmin(ctx.kit, { email: 'admin-patch-rename@x.c' });
	const p = makeFareProvider(ctx.kit, admin.id, { providerKey: 'stub', label: 'X' });

	const res = await PATCH(makeEvent({ id: String(p.id) }, admin, { label: 'Renamed' }));
	expect(res.status).toBe(204);

	const row = readProvider(p.id);
	expect(row.label).toBe('Renamed');
	expect(row.enabled).toBe(true);
	expect(countUpdateAudit(p.id)).toBe(1);
});

test('patch disables only and keeps the label', async () => {
	const admin = makeAdmin(ctx.kit, { email: 'admin-patch-disable@x.c' });
	const p = makeFareProvider(ctx.kit, admin.id, { providerKey: 'stub', label: 'X' });

	const res = await PATCH(makeEvent({ id: String(p.id) }, admin, { enabled: false }));
	expect(res.status).toBe(204);

	const row = readProvider(p.id);
	expect(row.label).toBe('X');
	expect(row.enabled).toBe(false);
});

test('patch enables a disabled provider', async () => {
	const admin = makeAdmin(ctx.kit, { email: 'admin-patch-enable@x.c' });
	const p = makeFareProvider(ctx.kit, admin.id, { providerKey: 'stub', label: 'X', enabled: false });

	const res = await PATCH(makeEvent({ id: String(p.id) }, admin, { enabled: true }));
	expect(res.status).toBe(204);

	const row = readProvider(p.id);
	expect(row.enabled).toBe(true);
	expect(row.label).toBe('X');
});

test('patch omits apiKey and keeps the stored key', async () => {
	const admin = makeAdmin(ctx.kit, { email: 'admin-patch-key@x.c' });
	const p = makeFareProvider(ctx.kit, admin.id, { providerKey: 'stub', label: 'X', apiKey: encrypt('RAW-KEY') });

	const res = await PATCH(makeEvent({ id: String(p.id) }, admin, { label: 'Renamed' }));
	expect(res.status).toBe(204);

	const row = readProvider(p.id);
	expect(row.api_key).toBe(p.apiKey);
	expect(decrypt(row.api_key!)).toBe('RAW-KEY');
});

test('patch rejects blank and oversized labels without mutating the row', async () => {
	const admin = makeAdmin(ctx.kit, { email: 'admin-patch-label@x.c' });
	const p = makeFareProvider(ctx.kit, admin.id, { providerKey: 'stub', label: 'X' });

	await expect(PATCH(makeEvent({ id: String(p.id) }, admin, { label: '   ' }))).rejects.toMatchObject({ status: 400, body: { message: 'Label is required and must be 200 characters or fewer.' } });
	await expect(PATCH(makeEvent({ id: String(p.id) }, admin, { label: 'x'.repeat(201) }))).rejects.toMatchObject({ status: 400, body: { message: 'Label is required and must be 200 characters or fewer.' } });

	const row = readProvider(p.id);
	expect(row.label).toBe('X');
	expect(row.enabled).toBe(true);
	expect(countUpdateAudit(p.id)).toBe(0);
});

test('patch rejects non-boolean enabled without mutating the row', async () => {
	const admin = makeAdmin(ctx.kit, { email: 'admin-patch-enabled@x.c' });
	const p = makeFareProvider(ctx.kit, admin.id, { providerKey: 'stub', label: 'X' });

	await expect(PATCH(makeEvent({ id: String(p.id) }, admin, { enabled: 'true' }))).rejects.toMatchObject({ status: 400 });
	await expect(PATCH(makeEvent({ id: String(p.id) }, admin, { enabled: 1 }))).rejects.toMatchObject({ status: 400 });

	const row = readProvider(p.id);
	expect(row.enabled).toBe(true);
});

test('patch rejects non-object and malformed bodies without mutating the row', async () => {
	const admin = makeAdmin(ctx.kit, { email: 'admin-patch-body@x.c' });
	const p = makeFareProvider(ctx.kit, admin.id, { providerKey: 'stub', label: 'X' });

	await expect(PATCH(makeEvent({ id: String(p.id) }, admin, null))).rejects.toMatchObject({ status: 400 });
	await expect(PATCH(makeEvent({ id: String(p.id) }, admin, ['x']))).rejects.toMatchObject({ status: 400 });
	await expect(PATCH(makeEvent({ id: String(p.id) }, admin))).rejects.toMatchObject({ status: 400 });

	const row = readProvider(p.id);
	expect(row.label).toBe('X');
	expect(row.enabled).toBe(true);
});

test('patch rejects unauthenticated, non-admin, foreign, and invalid-id requests', async () => {
	const admin = makeAdmin(ctx.kit, { email: 'admin-patch-access@x.c' });
	const p = makeFareProvider(ctx.kit, admin.id, { providerKey: 'stub', label: 'X' });

	await expect(PATCH(makeEvent({ id: String(p.id) }, null, { label: 'Renamed' }))).rejects.toMatchObject({ status: 401 });

	const user = makeUser(ctx.kit, { email: 'access-user@x.c' });
	await expect(PATCH(makeEvent({ id: String(p.id) }, user, { label: 'Renamed' }))).rejects.toMatchObject({ status: 403 });

	const other = makeAdmin(ctx.kit, { email: 'admin-patch-other@x.c' });
	await expect(PATCH(makeEvent({ id: String(p.id) }, other, { label: 'Renamed' }))).rejects.toMatchObject({ status: 404 });

	await expect(PATCH(makeEvent({ id: 'abc' }, admin, { label: 'Renamed' }))).rejects.toMatchObject({ status: 400 });

	const row = readProvider(p.id);
	expect(row.label).toBe('X');
	expect(row.enabled).toBe(true);
});
