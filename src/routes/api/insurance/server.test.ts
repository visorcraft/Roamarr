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
	ctx.kit.deleteFrom(insurancePolicies).executeSync();
	ctx.kit.deleteFrom(trips).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

import { GET } from './+server';
import { insurancePolicies, trips, users } from '$lib/server/db/mongrelSchema';
import { makeUser, makeTrip, makeInsurancePolicy } from '../../../../tests/helpers';
import { resetRateLimit } from '$lib/server/rateLimit';

function makeEvent(url: string, user: unknown) {
	return {
		url: new URL(url, 'http://localhost'),
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('returns paginated policies', async () => {
	const user = makeUser(ctx.kit);
	const trip = makeTrip(ctx.kit, user.id, { name: 'Summer' });
	const policy = makeInsurancePolicy(ctx.kit, user.id, {
		provider: 'Allianz',
		policyNumber: 'PN-1',
		coverageAmount: 50000,
		currency: 'USD',
		startDate: '2025-06-01',
		endDate: '2025-06-30',
		tripId: trip.id
	});

	const res = await GET(makeEvent('/api/insurance', user));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(1);
	expect(body.rows).toHaveLength(1);
	expect(body.rows[0]).toMatchObject({
		id: policy.id,
		provider: 'Allianz',
		policyNumber: 'PN-1',
		coverageAmount: 50000,
		currency: 'USD',
		startDate: '2025-06-01',
		endDate: '2025-06-30',
		tripId: trip.id,
		tripName: 'Summer'
	});
});

test('does not expose other users policies', async () => {
	const userA = makeUser(ctx.kit);
	const userB = makeUser(ctx.kit);
	makeInsurancePolicy(ctx.kit, userA.id, { provider: 'Allianz' });

	const res = await GET(makeEvent('/api/insurance', userB));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(0);
	expect(body.rows).toEqual([]);
});

test('rejects unauthenticated requests', async () => {
	await expect(GET(makeEvent('/api/insurance', null))).rejects.toMatchObject({ status: 401 });
});

test('filters by date range on start date', async () => {
	const user = makeUser(ctx.kit);
	makeInsurancePolicy(ctx.kit, user.id, { provider: 'A', startDate: '2024-12-15' });
	makeInsurancePolicy(ctx.kit, user.id, { provider: 'B', startDate: '2025-06-01' });
	makeInsurancePolicy(ctx.kit, user.id, { provider: 'C', startDate: '2025-10-01' });
	makeInsurancePolicy(ctx.kit, user.id, { provider: 'NoStart' });

	const resFrom = await GET(makeEvent('/api/insurance?from=2025-01-01', user));
	const bodyFrom = await resFrom.json();
	expect(bodyFrom.total).toBe(2);
	expect(bodyFrom.rows.map((r: any) => r.provider).sort()).toEqual(['B', 'C']);

	const resTo = await GET(makeEvent('/api/insurance?to=2025-01-01', user));
	const bodyTo = await resTo.json();
	expect(bodyTo.total).toBe(1);
	expect(bodyTo.rows[0].provider).toBe('A');

	const resRange = await GET(makeEvent('/api/insurance?from=2025-06-01&to=2025-06-30', user));
	const bodyRange = await resRange.json();
	expect(bodyRange.total).toBe(1);
	expect(bodyRange.rows[0].provider).toBe('B');
});

test('rate limits repeated requests', async () => {
	const user = makeUser(ctx.kit);
	makeInsurancePolicy(ctx.kit, user.id, { provider: 'Allianz' });
	for (let i = 0; i < 10; i++) {
		const res = await GET(makeEvent('/api/insurance', user));
		expect(res.status).toBe(200);
	}
	await expect(GET(makeEvent('/api/insurance', user))).rejects.toMatchObject({ status: 429 });
});
