import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { makeUser, makeCard } from '../../../../tests/helpers';

function makeEvent(url: string, user: unknown) {
	return {
		url: new URL(url, 'http://localhost'),
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('returns paginated cards', async () => {
	const user = makeUser(ctx.kit);
	const card = makeCard(ctx.kit, user.id, {
		nickname: 'Sapphire',
		network: 'visa',
		last4: '1234',
		notes: 'Primary card'
	});

	const res = await GET(makeEvent('/api/cards', user));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(1);
	expect(body.rows).toHaveLength(1);
	expect(body.rows[0]).toMatchObject({
		id: card.id,
		nickname: 'Sapphire',
		network: 'visa',
		last4: '1234',
		notes: 'Primary card'
	});
});
