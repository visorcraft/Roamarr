import { test, expect, vi, beforeEach, afterAll } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

beforeEach(() => {
	ctx.kit.deleteFrom(fareProviders).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
});

afterAll(() => {
	ctx.close();
});

import { load, actions } from './+page.server';
import { fareProviders, users, auditLogs } from '$lib/server/db/mongrelSchema';
import { registry } from '$lib/server/fareproviders';
import { decrypt } from '$lib/server/crypto';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { makeAdminLocals, makeUserLocals } from '../../../../tests/eventHelpers';

function event(user: { id: number } | null, body?: FormData) {
	return {
		locals: { user } as App.Locals,
		request: body ? ({ formData: async () => body } as Request) : undefined
	} as any;
}

test('load requires a signed-in user', () => {
	expect(() => load(event(null))).toThrow(expect.objectContaining({ status: 401 }));
});

test('load rejects non-admin users', () => {
	const user = makeUserLocals(ctx.kit);
	expect(() => load({ locals: user } as any)).toThrow(expect.objectContaining({ status: 403 }));
});

test('load exposes registry providers for admin', () => {
	const admin = makeAdminLocals(ctx.kit);
	const result = load({ locals: admin } as any) as { providers: { key: string; label: string }[] };
	expect(result.providers).toEqual(Object.values(registry).map((p) => ({ key: p.key, label: p.label })));
});

test('create action adds a provider account, logs audit, and redirects', async () => {
	const admin = makeAdminLocals(ctx.kit);
	const f = new FormData();
	f.set('providerKey', 'stub');
	f.set('label', 'Personal');
	f.set('apiKey', 'SECRET');
	f.set('enabled', 'on');

	await expect(actions.create(event(admin.user, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(fareProviders).where(kitEq(fareProviders.user_id, BigInt(admin.user.id))).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].label).toBe('Personal');
	expect(decrypt(rows[0].api_key!)).toBe('SECRET');
	expect(rows[0].enabled).toBe(true);

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('fare_provider_create');
	expect(logs[0].entity_type).toBe('fare_provider');
	expect(Number(logs[0].entity_id)).toBe(Number(rows[0].id));
});

test('create action rejects non-admin users', async () => {
	const user = makeUserLocals(ctx.kit);
	const f = new FormData();
	f.set('providerKey', 'stub');
	f.set('label', 'Personal');
	f.set('apiKey', 'SECRET');
	f.set('enabled', 'on');

	await expect(actions.create(event(user.user, f))).rejects.toMatchObject({ status: 403 });
});
