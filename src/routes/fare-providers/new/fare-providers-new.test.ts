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
});

afterAll(() => {
	ctx.close();
});

import { load, actions } from './+page.server';
import { fareProviders, users } from '$lib/server/db/mongrelSchema';
import { registry } from '$lib/server/fareproviders';
import { decrypt } from '$lib/server/crypto';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { makeUser } from '../../../../tests/helpers';

function event(user: { id: number } | null, body?: FormData) {
	return {
		locals: { user } as App.Locals,
		request: body ? ({ formData: async () => body } as Request) : undefined
	} as any;
}

test('load requires a signed-in user', () => {
	expect(() => load(event(null))).toThrow(expect.objectContaining({ status: 401 }));
});

test('load exposes registry providers', () => {
	const u = makeUser(ctx.kit, { email: 'fp-new@x.c', passwordHash: 'x' });
	const result = load(event({ id: u.id })) as { providers: { key: string; label: string }[] };
	expect(result.providers).toEqual(Object.values(registry).map((p) => ({ key: p.key, label: p.label })));
});

test('create action adds a provider account and redirects', async () => {
	const u = makeUser(ctx.kit, { email: 'fp-create@x.c', passwordHash: 'x' });
	const f = new FormData();
	f.set('providerKey', 'stub');
	f.set('label', 'Personal');
	f.set('apiKey', 'SECRET');
	f.set('enabled', 'on');

	await expect(actions.create(event({ id: Number(u.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(fareProviders).where(kitEq(fareProviders.user_id, BigInt(u.id))).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].label).toBe('Personal');
	expect(decrypt(rows[0].api_key!)).toBe('SECRET');
	expect(rows[0].enabled).toBe(true);
});
