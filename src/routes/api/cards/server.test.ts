import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { makeUser, makeCard } from '../../../../tests/helpers';
import { createCardBenefit } from '$lib/server/repositories/profileRepo';
import { resetRateLimit } from '$lib/server/rateLimit';
import { cards, users } from '$lib/server/db/mongrelSchema';

function makeEvent(url: string, user: unknown) {
	return {
		url: new URL(url, 'http://localhost'),
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

beforeEach(() => {
	resetRateLimit();
	ctx.kit.deleteFrom(cards).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
});

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
		benefitCount: 0
	});
	expect(body.rows[0]).not.toHaveProperty('notes');
});

test('does not expose other users cards', async () => {
	const userA = makeUser(ctx.kit);
	const userB = makeUser(ctx.kit);
	makeCard(ctx.kit, userA.id, { nickname: 'Sapphire', network: 'visa', last4: '1234' });

	const res = await GET(makeEvent('/api/cards', userB));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(0);
	expect(body.rows).toEqual([]);
});

test('rejects unauthenticated requests', async () => {
	await expect(GET(makeEvent('/api/cards', null))).rejects.toMatchObject({ status: 401 });
});

test('benefitCount reflects added benefits', async () => {
	const user = makeUser(ctx.kit);
	const card = makeCard(ctx.kit, user.id, { nickname: 'Sapphire', network: 'visa' });
	createCardBenefit(user.id, card.id, { benefitType: 'trip_delay', coverageAmount: 100 });
	createCardBenefit(user.id, card.id, { benefitType: 'baggage_delay', coverageAmount: 50 });

	const res = await GET(makeEvent('/api/cards', user));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(1);
	expect(body.rows[0].benefitCount).toBe(2);
});

test('rate limits repeated requests', async () => {
	const user = makeUser(ctx.kit);
	makeCard(ctx.kit, user.id, { nickname: 'Sapphire', network: 'visa' });
	for (let i = 0; i < 10; i++) {
		const res = await GET(makeEvent('/api/cards', user));
		expect(res.status).toBe(200);
	}
	await expect(GET(makeEvent('/api/cards', user))).rejects.toMatchObject({ status: 429 });
});
