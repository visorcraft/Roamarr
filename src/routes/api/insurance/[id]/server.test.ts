import { test, expect, vi, beforeEach } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

beforeEach(() => {
	ctx.kit.deleteFrom(insurancePolicies).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	ctx.kit.deleteFrom(trips).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

import { DELETE } from './+server';
import { insurancePolicies, auditLogs, trips, users } from '$lib/server/db/mongrelSchema';
import { kit } from '$lib/server/db';
import { makeUser, makeInsurancePolicy } from '../../../../../tests/helpers';
import { resetRateLimit } from '$lib/server/rateLimit';

function makeEvent(params: Record<string, string>, user: unknown) {
	return {
		params,
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('delete removes an owned policy, logs audit, and returns 204', async () => {
	const user = makeUser(ctx.kit, { email: 'owner@x.c' });
	const policy = makeInsurancePolicy(ctx.kit, user.id, { provider: 'Allianz' });

	const res = await DELETE(makeEvent({ id: String(policy.id) }, user));
	expect(res.status).toBe(204);

	expect(kit.selectFrom(insurancePolicies).executeSync()).toHaveLength(0);

	const logs = kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('insurance_policy_delete');
	expect(logs[0].entity_type).toBe('insurance_policy');
	expect(Number(logs[0].entity_id)).toBe(policy.id);
});

test('delete returns 404 for another users policy', async () => {
	const owner = makeUser(ctx.kit, { email: 'owner@x.c' });
	const other = makeUser(ctx.kit, { email: 'other@x.c' });
	const policy = makeInsurancePolicy(ctx.kit, owner.id, { provider: 'Allianz' });

	await expect(DELETE(makeEvent({ id: String(policy.id) }, other))).rejects.toMatchObject({ status: 404 });

	expect(kit.selectFrom(insurancePolicies).executeSync()).toHaveLength(1);
});

test('delete rejects unauthenticated requests', async () => {
	await expect(DELETE(makeEvent({ id: '1' }, null))).rejects.toMatchObject({ status: 401 });
});

test('delete rate limits repeated requests', async () => {
	const user = makeUser(ctx.kit, { email: 'rate@x.c' });
	for (let i = 0; i < 10; i++) {
		const policy = makeInsurancePolicy(ctx.kit, user.id, { provider: `Ins ${i}` });
		const res = await DELETE(makeEvent({ id: String(policy.id) }, user));
		expect(res.status).toBe(204);
	}

	const last = makeInsurancePolicy(ctx.kit, user.id, { provider: 'Last' });
	await expect(DELETE(makeEvent({ id: String(last.id) }, user))).rejects.toMatchObject({ status: 429 });
});
