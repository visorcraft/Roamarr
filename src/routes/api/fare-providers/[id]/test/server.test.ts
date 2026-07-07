import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { POST } from './+server';
import { makeUser, makeFareProvider } from '../../../../../../tests/helpers';

function makeEvent(params: Record<string, string>, user: unknown) {
	return {
		params,
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('test returns the stub result for an owned provider', async () => {
	const user = makeUser(ctx.kit);
	const p = makeFareProvider(ctx.kit, user.id, { providerKey: 'stub', label: 'Test', apiKey: null });

	const res = await POST(makeEvent({ id: String(p.id) }, user));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.ok).toBe(true);
	expect(body.summary).toContain('stub provider');
});

test('test rejects another users provider', async () => {
	const owner = makeUser(ctx.kit);
	const other = makeUser(ctx.kit);
	const p = makeFareProvider(ctx.kit, owner.id, { providerKey: 'stub', label: 'X' });

	await expect(POST(makeEvent({ id: String(p.id) }, other))).rejects.toMatchObject({ status: 404 });
});

test('test rejects invalid id', async () => {
	const user = makeUser(ctx.kit);
	await expect(POST(makeEvent({ id: 'abc' }, user))).rejects.toMatchObject({ status: 400 });
});

test('test rejects unauthenticated requests', async () => {
	await expect(POST(makeEvent({ id: '1' }, null))).rejects.toMatchObject({ status: 401 });
});
