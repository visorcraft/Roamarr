import { test, expect, vi, beforeEach, afterAll } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

beforeEach(() => {
	ctx.kit.deleteFrom(fareProviders).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	resetRateLimit(clientAddress, 'fare-providers:update');
});

afterAll(() => {
	ctx.close();
});

import { load, actions } from './+page.server';
import { fareProviders, users, auditLogs } from '$lib/server/db/mongrelSchema';
import { createProvider } from '$lib/server/fareproviders';
import { decrypt } from '$lib/server/crypto';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { resetRateLimit } from '$lib/server/rateLimit';
import { makeAdminLocals, makeUserLocals } from '../../../../../tests/eventHelpers';

const clientAddress = '127.0.0.1';

function event(user: { id: number } | null, params: Record<string, string>, body?: FormData) {
	return {
		locals: { user } as App.Locals,
		params,
		request: body ? ({ formData: async () => body } as Request) : undefined,
		getClientAddress: () => clientAddress
	} as any;
}

test('load requires a signed-in user', () => {
	expect(() => load(event(null, { id: '1' }))).toThrow(expect.objectContaining({ status: 401 }));
});

test('load rejects non-admin users', () => {
	const user = makeUserLocals(ctx.kit);
	expect(() => load(event(user.user, { id: '1' }))).toThrow(expect.objectContaining({ status: 403 }));
});

test('load returns 404 for a missing or non-owned provider', () => {
	const admin = makeAdminLocals(ctx.kit);
	expect(() => load(event(admin.user, { id: '999' }))).toThrow(
		expect.objectContaining({ status: 404 })
	);
});

test('load returns provider data without the api key', () => {
	const admin = makeAdminLocals(ctx.kit);
	const p = createProvider(admin.user.id, 'stub', 'Work', 'SECRET', true);
	const result = load(event(admin.user, { id: String(p.id) })) as {
		provider: { id: number; label: string; enabled: boolean; hasKey: boolean; apiKey?: string };
	};
	expect(result.provider.id).toBe(p.id);
	expect(result.provider.label).toBe('Work');
	expect(result.provider.enabled).toBe(true);
	expect(result.provider.hasKey).toBe(true);
	expect(result.provider.apiKey).toBeUndefined();
});

test('update action edits an owned account, logs audit, and redirects', async () => {
	const admin = makeAdminLocals(ctx.kit);
	const other = makeUserLocals(ctx.kit);
	const p = createProvider(admin.user.id, 'stub', 'Old', 'ORIGINAL', true);

	const f = new FormData();
	f.set('label', 'New');
	f.set('apiKey', 'NEW-SECRET');
	f.set('enabled', 'on');
	await expect(actions.update(event(admin.user, { id: String(p.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const row = ctx.kit.selectFrom(fareProviders).where(kitEq(fareProviders.id, BigInt(p.id))).executeSync()[0];
	expect(row!.label).toBe('New');
	expect(decrypt(row!.api_key!)).toBe('NEW-SECRET');

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('fare_provider_update');
	expect(logs[0].entity_type).toBe('fare_provider');
	expect(Number(logs[0].entity_id)).toBe(p.id);

	const hijack = new FormData();
	hijack.set('label', 'Hijacked');
	hijack.set('apiKey', 'X');
	await expect(actions.update(event(other.user, { id: String(p.id) }, hijack))).rejects.toMatchObject({
		status: 403
	});

	const after = ctx.kit.selectFrom(fareProviders).where(kitEq(fareProviders.id, BigInt(p.id))).executeSync()[0];
	expect(after!.label).toBe('New');
	expect(decrypt(after!.api_key!)).toBe('NEW-SECRET');
});

test('update action rejects invalid params id', async () => {
	const admin = makeAdminLocals(ctx.kit);
	const f = new FormData();
	f.set('label', 'New');
	await expect(actions.update(event(admin.user, { id: 'abc' }, f))).rejects.toMatchObject({ status: 404 });
});

test('update action is rate limited', async () => {
	const admin = makeAdminLocals(ctx.kit);
	const p = createProvider(admin.user.id, 'stub', 'Old', 'ORIGINAL', true);
	for (let i = 0; i < 10; i += 1) {
		const f = new FormData();
		f.set('label', `New ${i}`);
		f.set('apiKey', 'NEW-SECRET');
		try {
			await actions.update(event(admin.user, { id: String(p.id) }, f));
		} catch (e: any) {
			expect(e.status).toBe(303);
		}
	}
	const f = new FormData();
	f.set('label', 'Blocked');
	f.set('apiKey', 'NEW-SECRET');
	const result = await actions.update(event(admin.user, { id: String(p.id) }, f));
	expect(result).toMatchObject({ status: 429, data: { error: 'Too many attempts. Try again later.' } });
});
