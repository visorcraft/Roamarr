import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

beforeEach(() => {
	ctx.kit.deleteFrom(loyaltyPrograms).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

import { GET } from './+server';
import { loyaltyPrograms, users } from '$lib/server/db/mongrelSchema';
import { makeUser } from '../../../../tests/helpers';
import { resetRateLimit } from '$lib/server/rateLimit';
import { createLoyaltyProgram } from '$lib/server/repositories/profileRepo';

function makeEvent(url: string, user: unknown) {
	return {
		url: new URL(url, 'http://localhost'),
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('returns paginated programs for the signed-in user', async () => {
	const user = makeUser(ctx.kit);
	createLoyaltyProgram(user.id, { programName: 'United MileagePlus', balance: 50000 });
	createLoyaltyProgram(user.id, { programName: 'Marriott Bonvoy', balance: 120000 });

	const res = await GET(makeEvent('/api/loyalty', user));
	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body.total).toBe(2);
	expect(body.rows).toHaveLength(2);
	const united = body.rows.find((r: any) => r.programName === 'United MileagePlus');
	expect(united).toMatchObject({ programName: 'United MileagePlus', balance: 50000 });
	expect(united.balanceUpdatedAt).not.toBeNull();
});

test('does not expose other users programs', async () => {
	const a = makeUser(ctx.kit);
	const b = makeUser(ctx.kit, { email: 'b@x.c' });
	createLoyaltyProgram(a.id, { programName: 'A only' });

	const res = await GET(makeEvent('/api/loyalty', b));
	const body = await res.json();
	expect(body.total).toBe(0);
	expect(body.rows).toEqual([]);
});

test('rejects unauthenticated requests', async () => {
	await expect(GET(makeEvent('/api/loyalty', null))).rejects.toMatchObject({ status: 401 });
});

test('search filters by program name', async () => {
	const user = makeUser(ctx.kit);
	createLoyaltyProgram(user.id, { programName: 'United MileagePlus' });
	createLoyaltyProgram(user.id, { programName: 'Marriott Bonvoy' });

	const res = await GET(makeEvent('/api/loyalty?search=united', user));
	const body = await res.json();
	expect(body.total).toBe(1);
	expect(body.rows[0].programName).toBe('United MileagePlus');
});

test('rate limits repeated requests', async () => {
	const user = makeUser(ctx.kit);
	createLoyaltyProgram(user.id, { programName: 'X' });
	for (let i = 0; i < 10; i++) {
		const res = await GET(makeEvent('/api/loyalty', user));
		expect(res.status).toBe(200);
	}
	await expect(GET(makeEvent('/api/loyalty', user))).rejects.toMatchObject({ status: 429 });
});
