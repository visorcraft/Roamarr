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
});

afterAll(() => {
	ctx.close();
});

import { load, actions } from './+page.server';
import { fareProviders, users } from '$lib/server/db/mongrelSchema';
import { createProvider } from '$lib/server/fareproviders';
import { decrypt } from '$lib/server/crypto';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { makeUser } from '../../../../../tests/helpers';

function event(user: { id: number } | null, params: Record<string, string>, body?: FormData) {
	return {
		locals: { user } as App.Locals,
		params,
		request: body ? ({ formData: async () => body } as Request) : undefined
	} as any;
}

test('load requires a signed-in user', () => {
	expect(() => load(event(null, { id: '1' }))).toThrow(expect.objectContaining({ status: 401 }));
});

test('load returns 404 for a missing or non-owned provider', () => {
	const u = makeUser(ctx.kit, { email: 'fp-edit@x.c', passwordHash: 'x' });
	expect(() => load(event({ id: Number(u.id) }, { id: '999' }))).toThrow(
		expect.objectContaining({ status: 404 })
	);
});

test('load returns provider data without the api key', () => {
	const u = makeUser(ctx.kit, { email: 'fp-edit2@x.c', passwordHash: 'x' });
	const p = createProvider(u.id, 'stub', 'Work', 'SECRET', true);
	const result = load(event({ id: Number(u.id) }, { id: String(p.id) })) as {
		provider: { id: number; label: string; enabled: boolean; hasKey: boolean; apiKey?: string };
	};
	expect(result.provider.id).toBe(p.id);
	expect(result.provider.label).toBe('Work');
	expect(result.provider.enabled).toBe(true);
	expect(result.provider.hasKey).toBe(true);
	expect(result.provider.apiKey).toBeUndefined();
});

test('update action edits an owned account and redirects', async () => {
	const u = makeUser(ctx.kit, { email: 'fp-up@x.c', passwordHash: 'x' });
	const other = makeUser(ctx.kit, { email: 'fp-other@x.c', passwordHash: 'x' });
	const p = createProvider(u.id, 'stub', 'Old', 'ORIGINAL', true);

	const f = new FormData();
	f.set('id', String(p.id));
	f.set('label', 'New');
	f.set('apiKey', 'NEW-SECRET');
	f.set('enabled', 'on');
	await expect(actions.update(event({ id: Number(u.id) }, { id: String(p.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const row = ctx.kit.selectFrom(fareProviders).where(kitEq(fareProviders.id, BigInt(p.id))).executeSync()[0];
	expect(row!.label).toBe('New');
	expect(decrypt(row!.api_key!)).toBe('NEW-SECRET');

	const hijack = new FormData();
	hijack.set('id', String(p.id));
	hijack.set('label', 'Hijacked');
	hijack.set('apiKey', 'X');
	await expect(actions.update(event({ id: Number(other.id) }, { id: String(p.id) }, hijack))).rejects.toThrow();

	const after = ctx.kit.selectFrom(fareProviders).where(kitEq(fareProviders.id, BigInt(p.id))).executeSync()[0];
	expect(after!.label).toBe('New');
	expect(decrypt(after!.api_key!)).toBe('NEW-SECRET');
});
