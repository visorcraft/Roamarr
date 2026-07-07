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
import { makeUser } from '../../../tests/helpers';

function event(user: { id: number } | null) {
	return {
		locals: { user } as App.Locals
	} as any;
}

test('load requires a signed-in user', () => {
	expect(() => load(event(null))).toThrow(expect.objectContaining({ status: 401 }));
});

test('load returns registry provider labels', () => {
	const u = makeUser(ctx.kit, { email: 'fp@x.c', passwordHash: 'x' });
	const result = load(event({ id: u.id })) as { providers: { key: string; label: string }[] };
	expect(result.providers).toEqual(Object.values(registry).map((p) => ({ key: p.key, label: p.label })));
});
