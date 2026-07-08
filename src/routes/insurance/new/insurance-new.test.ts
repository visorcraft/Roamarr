import { test, expect, vi, beforeEach, afterAll } from 'vitest';
import { resetRateLimit } from '$lib/server/rateLimit';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
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
import { makeUserLocals } from '../../../../tests/eventHelpers';
import { makeTrip, makeUser } from '../../../../tests/helpers';

function event(user: { id: number } | null, body?: FormData, clientAddress = '127.0.0.1') {
	return {
		locals: { user } as App.Locals,
		request: body ? ({ formData: async () => body } as Request) : undefined,
		getClientAddress: () => clientAddress
	} as any;
}

test('load requires a signed-in user', () => {
	expect(() => load(event(null))).toThrow(expect.objectContaining({ status: 401 }));
});

test('load returns trips for the signed-in user', () => {
	const user = makeUserLocals(ctx.kit);
	makeTrip(ctx.kit, user.user.id, { name: 'Summer' });
	const result = load(event(user.user)) as { trips: Array<{ id: number; name: string }> };
	expect(result.trips).toHaveLength(1);
	expect(result.trips[0].name).toBe('Summer');
});

test('create action adds a policy, logs audit, and redirects', async () => {
	const user = makeUserLocals(ctx.kit);
	const f = new FormData();
	f.set('provider', 'Allianz');
	f.set('policyNumber', 'PN-1');
	f.set('coverageSummary', 'Comprehensive');
	f.set('coverageAmount', '50000');
	f.set('currency', 'USD');
	f.set('notes', 'Annual policy');

	await expect(actions.create(event(user.user, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(insurancePolicies).where(kitEq(insurancePolicies.user_id, BigInt(user.user.id))).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].provider).toBe('Allianz');
	expect(rows[0].policy_number).toBe('PN-1');
	expect(rows[0].coverage_summary).toBe('Comprehensive');
	expect(Number(rows[0].coverage_amount)).toBe(50000);
	expect(rows[0].currency).toBe('USD');
	expect(rows[0].notes).toBe('Annual policy');

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('insurance_policy_create');
	expect(logs[0].entity_type).toBe('insurance_policy');
	expect(Number(logs[0].entity_id)).toBe(Number(rows[0].id));
});

test('create action links an owned trip', async () => {
	const user = makeUserLocals(ctx.kit);
	const trip = makeTrip(ctx.kit, user.user.id, { name: 'Summer' });

	const f = new FormData();
	f.set('provider', 'Allianz');
	f.set('currency', 'USD');
	f.set('tripId', String(trip.id));

	await expect(actions.create(event(user.user, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(insurancePolicies).where(kitEq(insurancePolicies.user_id, BigInt(user.user.id))).executeSync();
	expect(rows).toHaveLength(1);
	expect(Number(rows[0].trip_id)).toBe(trip.id);
});

test('create action rejects empty provider with errors object', async () => {
	const user = makeUserLocals(ctx.kit);

	const f = new FormData();
	f.set('provider', '');
	f.set('currency', 'USD');
	const result = (await actions.create(event(user.user, f))) as {
		status: number;
		data: { error: string; errors: Record<string, string>; values?: Record<string, unknown> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.provider).toBe('provider is required');
	expect(result.data.values?.provider).toBe('');

	expect(ctx.kit.selectFrom(insurancePolicies).executeSync()).toHaveLength(0);
});

test('create action rejects negative coverage amount and bad currency', async () => {
	const user = makeUserLocals(ctx.kit);

	const f = new FormData();
	f.set('provider', 'Allianz');
	f.set('coverageAmount', '-5');
	f.set('currency', 'dollars');
	const result = (await actions.create(event(user.user, f))) as {
		status: number;
		data: { error: string; errors: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.coverageAmount).toBe('Coverage amount cannot be negative');
	expect(result.data.errors.currency).toContain('3-letter currency code');

	expect(ctx.kit.selectFrom(insurancePolicies).executeSync()).toHaveLength(0);
});

test('create action rejects reversed date range', async () => {
	const user = makeUserLocals(ctx.kit);

	const f = new FormData();
	f.set('provider', 'Allianz');
	f.set('currency', 'USD');
	f.set('startDate', '2025-12-31');
	f.set('endDate', '2025-01-01');
	const result = (await actions.create(event(user.user, f))) as {
		status: number;
		data: { error: string; errors: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.startDate).toContain('must be on or before');

	expect(ctx.kit.selectFrom(insurancePolicies).executeSync()).toHaveLength(0);
});

test('create action rejects foreign trip', async () => {
	const owner = makeUserLocals(ctx.kit);
	const other = makeUser(ctx.kit, { email: 'other@x.c' });
	const otherTrip = makeTrip(ctx.kit, other.id, { name: 'Other' });

	const f = new FormData();
	f.set('provider', 'Allianz');
	f.set('currency', 'USD');
	f.set('tripId', String(otherTrip.id));

	await expect(actions.create(event(owner.user, f))).rejects.toMatchObject({ status: 404 });

	expect(ctx.kit.selectFrom(insurancePolicies).executeSync()).toHaveLength(0);
});

test('create action preserves coverage amount 0', async () => {
	const user = makeUserLocals(ctx.kit);

	const f = new FormData();
	f.set('provider', 'Allianz');
	f.set('coverageAmount', '0');
	f.set('currency', 'USD');

	await expect(actions.create(event(user.user, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(insurancePolicies).executeSync();
	expect(rows).toHaveLength(1);
	expect(Number(rows[0].coverage_amount)).toBe(0);
});

test('create action rate limits repeated requests', async () => {
	const user = makeUserLocals(ctx.kit);
	for (let i = 0; i < 10; i++) {
		const f = new FormData();
		f.set('provider', `Insurer ${i}`);
		f.set('currency', 'USD');
		await expect(actions.create(event(user.user, f))).rejects.toEqual(
			expect.objectContaining({ status: 303 })
		);
	}

	const f = new FormData();
	f.set('provider', 'Blocked');
	f.set('currency', 'USD');
	const result = (await actions.create(event(user.user, f))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(429);
	expect(result.data.error).toBe('Too many attempts. Try again later.');
});
