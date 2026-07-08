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
	ctx.kit.deleteFrom(loyaltyPrograms).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

afterAll(() => {
	ctx.close();
});

import { load, actions } from './+page.server';
import { loyaltyPrograms, auditLogs, users } from '$lib/server/db/mongrelSchema';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { makeUserLocals } from '../../../../../tests/eventHelpers';

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

test('create action adds a program with balance, stamps balance_updated_at, logs audit, redirects', async () => {
	const user = makeUserLocals(ctx.kit);
	const f = new FormData();
	f.set('programName', 'United MileagePlus');
	f.set('membershipNumber', 'UA999');
	f.set('balance', '50000');
	f.set('notes', 'Premier 1K');

	await expect(actions.create(event(user.user, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(loyaltyPrograms).where(kitEq(loyaltyPrograms.user_id, BigInt(user.user.id))).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].program_name).toBe('United MileagePlus');
	expect(rows[0].membership_number).toBe('UA999');
	expect(Number(rows[0].balance)).toBe(50000);
	expect(rows[0].notes).toBe('Premier 1K');
	// balance_updated_at stamped because balance was provided
	expect(rows[0].balance_updated_at).not.toBeNull();

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('loyalty_program_create');
	expect(logs[0].entity_type).toBe('loyalty_program');
});

test('create action without balance leaves balance_updated_at null', async () => {
	const user = makeUserLocals(ctx.kit);
	const f = new FormData();
	f.set('programName', 'No balance yet');

	await expect(actions.create(event(user.user, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(loyaltyPrograms).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].balance).toBeNull();
	expect(rows[0].balance_updated_at).toBeNull();
});

test('create action rejects empty program name', async () => {
	const user = makeUserLocals(ctx.kit);
	const f = new FormData();
	f.set('programName', '');
	f.set('balance', '100');

	const result = (await actions.create(event(user.user, f))) as {
		status: number;
		data: { error: string; errors: Record<string, string>; values?: Record<string, unknown> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.programName).toBe('programName is required');
	expect(ctx.kit.selectFrom(loyaltyPrograms).executeSync()).toHaveLength(0);
});

test('create action rejects negative balance', async () => {
	const user = makeUserLocals(ctx.kit);
	const f = new FormData();
	f.set('programName', 'Bad');
	f.set('balance', '-50');

	const result = (await actions.create(event(user.user, f))) as {
		status: number;
		data: { errors: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.balance).toBe('Balance cannot be negative');
});

test('create action rate limits', async () => {
	const user = makeUserLocals(ctx.kit);
	for (let i = 0; i < 10; i++) {
		const f = new FormData();
		f.set('programName', `Program ${i}`);
		await expect(actions.create(event(user.user, f))).rejects.toEqual(
			expect.objectContaining({ status: 303 })
		);
	}

	const f = new FormData();
	f.set('programName', 'Blocked');
	const result = (await actions.create(event(user.user, f))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(429);
});
