import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { DELETE } from './+server';
import { makeUser, makeFareProvider } from '../../../../../tests/helpers';
import { fareProviders } from '$lib/server/db/mongrelSchema';
import { kit } from '$lib/server/db';

function makeEvent(params: Record<string, string>, user: unknown) {
	return {
		params,
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('delete removes an owned provider and returns 204', async () => {
	const user = makeUser(ctx.kit);
	const p = makeFareProvider(ctx.kit, user.id, { providerKey: 'stub', label: 'X' });

	const res = await DELETE(makeEvent({ id: String(p.id) }, user));
	expect(res.status).toBe(204);

	const rows = kit.selectFrom(fareProviders).executeSync();
	expect(rows).toHaveLength(0);
});

test('delete rejects another users provider', async () => {
	const owner = makeUser(ctx.kit);
	const other = makeUser(ctx.kit);
	const p = makeFareProvider(ctx.kit, owner.id, { providerKey: 'stub', label: 'X' });

	await expect(DELETE(makeEvent({ id: String(p.id) }, other))).rejects.toMatchObject({ status: 404 });
});

test('delete rejects invalid id', async () => {
	const user = makeUser(ctx.kit);
	await expect(DELETE(makeEvent({ id: 'abc' }, user))).rejects.toMatchObject({ status: 400 });
});

test('delete rejects unauthenticated requests', async () => {
	await expect(DELETE(makeEvent({ id: '1' }, null))).rejects.toMatchObject({ status: 401 });
});
