import { test, expect, vi, beforeEach, afterAll } from 'vitest';
import { resetRateLimit } from '$lib/server/rateLimit';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

beforeEach(() => {
	ctx.kit.deleteFrom(insurancePolicies).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	ctx.kit.deleteFrom(trips).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

afterAll(() => {
	ctx.close();
});

import { load, actions } from './+page.server';
import { insurancePolicies, auditLogs, trips, users } from '$lib/server/db/mongrelSchema';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { makeUserLocals } from '../../../../../tests/eventHelpers';
import { makeTrip, makeUser } from '../../../../../tests/helpers';
import { addPolicy } from '$lib/server/insurancePolicies';

function event(
	user: { id: number } | null,
	params: Record<string, string>,
	body?: FormData,
	clientAddress = '127.0.0.1'
) {
	return {
		locals: { user } as App.Locals,
		params,
		request: body ? ({ formData: async () => body } as Request) : undefined,
		getClientAddress: () => clientAddress
	} as any;
}

test('load requires a signed-in user', () => {
	expect(() => load(event(null, { id: '1' }))).toThrow(expect.objectContaining({ status: 401 }));
});

test('load returns 404 for a missing or non-owned policy', () => {
	const user = makeUserLocals(ctx.kit);
	expect(() => load(event(user.user, { id: '999' }))).toThrow(
		expect.objectContaining({ status: 404 })
	);
});

test('load returns policy and trips', () => {
	const user = makeUserLocals(ctx.kit);
	const trip = makeTrip(ctx.kit, user.user.id, { name: 'Summer' });
	const policy = addPolicy(user.user.id, { provider: 'Allianz', tripId: trip.id });

	const result = load(event(user.user, { id: String(policy.id) })) as {
		policy: { id: number; provider: string; tripId: number | null };
		trips: Array<{ id: number; name: string }>;
	};
	expect(result.policy.id).toBe(policy.id);
	expect(result.policy.provider).toBe('Allianz');
	expect(result.policy.tripId).toBe(trip.id);
	expect(result.trips).toHaveLength(1);
	expect(result.trips[0].name).toBe('Summer');
});

test('update action edits an owned policy, logs audit, and redirects', async () => {
	const user = makeUserLocals(ctx.kit);
	const other = makeUser(ctx.kit, { email: 'other@x.c' });
	const policy = addPolicy(user.user.id, { provider: 'Old' });

	const f = new FormData();
	f.set('provider', 'Allianz');
	f.set('policyNumber', 'PN-1');
	f.set('coverageAmount', '50000');
	f.set('currency', 'USD');
	f.set('startDate', '2025-01-01');
	f.set('endDate', '2025-12-31');
	f.set('notes', 'Updated notes');

	await expect(actions.update(event(user.user, { id: String(policy.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const row = ctx.kit.selectFrom(insurancePolicies).where(kitEq(insurancePolicies.id, BigInt(policy.id))).executeSync()[0];
	expect(row!.provider).toBe('Allianz');
	expect(row!.policy_number).toBe('PN-1');
	expect(Number(row!.coverage_amount)).toBe(50000);
	expect(row!.start_date).toBe('2025-01-01');
	expect(row!.end_date).toBe('2025-12-31');
	expect(row!.notes).toBe('Updated notes');

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('insurance_policy_update');
	expect(logs[0].entity_type).toBe('insurance_policy');
	expect(Number(logs[0].entity_id)).toBe(policy.id);

	const hijack = new FormData();
	hijack.set('provider', 'Hijacked');
	hijack.set('currency', 'USD');
	await expect(actions.update(event(other, { id: String(policy.id) }, hijack))).rejects.toMatchObject({
		status: 404
	});

	const after = ctx.kit.selectFrom(insurancePolicies).where(kitEq(insurancePolicies.id, BigInt(policy.id))).executeSync()[0];
	expect(after!.provider).toBe('Allianz');
});

test('update action can clear trip link', async () => {
	const user = makeUserLocals(ctx.kit);
	const trip = makeTrip(ctx.kit, user.user.id, { name: 'Summer' });
	const policy = addPolicy(user.user.id, { provider: 'Allianz', tripId: trip.id });

	const f = new FormData();
	f.set('provider', 'Allianz');
	f.set('currency', 'USD');
	f.set('tripId', '');

	await expect(actions.update(event(user.user, { id: String(policy.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const row = ctx.kit.selectFrom(insurancePolicies).where(kitEq(insurancePolicies.id, BigInt(policy.id))).executeSync()[0];
	expect(row!.trip_id).toBeNull();
});

test('update action rejects empty provider with errors object', async () => {
	const user = makeUserLocals(ctx.kit);
	const policy = addPolicy(user.user.id, { provider: 'Allianz' });

	const f = new FormData();
	f.set('provider', '');
	f.set('currency', 'USD');
	const result = (await actions.update(event(user.user, { id: String(policy.id) }, f))) as {
		status: number;
		data: { error: string; errors: Record<string, string>; values?: Record<string, unknown> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.provider).toBe('provider is required');
	expect(result.data.values?.provider).toBe('');

	const row = ctx.kit.selectFrom(insurancePolicies).where(kitEq(insurancePolicies.id, BigInt(policy.id))).executeSync()[0];
	expect(row!.provider).toBe('Allianz');
});

test('update action rejects reversed date range', async () => {
	const user = makeUserLocals(ctx.kit);
	const policy = addPolicy(user.user.id, { provider: 'Allianz' });

	const f = new FormData();
	f.set('provider', 'Allianz');
	f.set('currency', 'USD');
	f.set('startDate', '2025-12-31');
	f.set('endDate', '2025-01-01');
	const result = (await actions.update(event(user.user, { id: String(policy.id) }, f))) as {
		status: number;
		data: { error: string; errors: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.startDate).toContain('must be on or before');
});

test('update action rejects foreign trip', async () => {
	const owner = makeUserLocals(ctx.kit);
	const other = makeUser(ctx.kit, { email: 'other@x.c' });
	const otherTrip = makeTrip(ctx.kit, other.id, { name: 'Other' });
	const policy = addPolicy(owner.user.id, { provider: 'Allianz' });

	const f = new FormData();
	f.set('provider', 'Allianz');
	f.set('currency', 'USD');
	f.set('tripId', String(otherTrip.id));

	await expect(actions.update(event(owner.user, { id: String(policy.id) }, f))).rejects.toMatchObject({
		status: 404
	});

	const row = ctx.kit.selectFrom(insurancePolicies).where(kitEq(insurancePolicies.id, BigInt(policy.id))).executeSync()[0];
	expect(row!.trip_id).toBeNull();
});

test('update action rate limits repeated requests', async () => {
	const user = makeUserLocals(ctx.kit);
	const policy = addPolicy(user.user.id, { provider: 'Allianz' });
	for (let i = 0; i < 10; i++) {
		const f = new FormData();
		f.set('provider', `Updated ${i}`);
		f.set('currency', 'USD');
		await expect(actions.update(event(user.user, { id: String(policy.id) }, f))).rejects.toEqual(
			expect.objectContaining({ status: 303 })
		);
	}

	const f = new FormData();
	f.set('provider', 'Blocked');
	f.set('currency', 'USD');
	const result = (await actions.update(event(user.user, { id: String(policy.id) }, f))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(429);
	expect(result.data.error).toBe('Too many attempts. Try again later.');
});
