import { test, expect, vi, beforeEach, afterAll } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
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

import { load } from './+page.server';
import { fareProviders, users } from '$lib/server/db/mongrelSchema';
import { registry } from '$lib/server/fareproviders';
import { makeAdminLocals, makeUserLocals } from '../../../tests/eventHelpers';

function event(user: { id: number } | null) {
	return {
		locals: { user } as App.Locals
	} as any;
}

test('load requires a signed-in user', () => {
	expect(() => load(event(null))).toThrow(expect.objectContaining({ status: 401 }));
});

test('load rejects non-admin users', () => {
	const user = makeUserLocals(ctx.kit);
	expect(() => load({ locals: user } as any)).toThrow(expect.objectContaining({ status: 403 }));
});

test('load returns registry provider labels for admin', () => {
	const admin = makeAdminLocals(ctx.kit);
	const result = load({ locals: admin } as any) as { providers: { key: string; label: string }[] };
	expect(result.providers).toEqual(Object.values(registry).map((p) => ({ key: p.key, label: p.label })));
});
