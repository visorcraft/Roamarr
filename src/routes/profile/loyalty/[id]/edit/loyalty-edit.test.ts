import { test, expect, vi, beforeEach, afterAll } from 'vitest';
import { resetRateLimit } from '$lib/server/rateLimit';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../../tests/helpers');
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
import { makeUserLocals } from '../../../../../../tests/eventHelpers';
import { makeUser } from '../../../../../../tests/helpers';
import { createLoyaltyProgram } from '$lib/server/repositories/profileRepo';

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

test('load returns 404 for missing or non-owned program', () => {
	const user = makeUserLocals(ctx.kit);
	expect(() => load(event(user.user, { id: '999' }))).toThrow(
		expect.objectContaining({ status: 404 })
	);
});

test('load returns the program', () => {
	const user = makeUserLocals(ctx.kit);
	const program = createLoyaltyProgram(user.user.id, { programName: 'United', balance: 1000 });

	const result = load(event(user.user, { id: String(program.id) })) as {
		program: { id: number; programName: string; balance: number | null; balanceUpdatedAt: string | null };
	};
	expect(result.program.id).toBe(program.id);
	expect(result.program.programName).toBe('United');
	expect(result.program.balance).toBe(1000);
	expect(result.program.balanceUpdatedAt).not.toBeNull();
});

test('update action edits fields, logs audit, redirects', async () => {
	const user = makeUserLocals(ctx.kit);
	const program = createLoyaltyProgram(user.user.id, { programName: 'Old', balance: 1000 });

	const f = new FormData();
	f.set('programName', 'Updated');
	f.set('membershipNumber', 'UA999');
	f.set('balance', '5000');
	f.set('notes', 'After flight');

	await expect(actions.update(event(user.user, { id: String(program.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const row = ctx.kit.selectFrom(loyaltyPrograms).where(kitEq(loyaltyPrograms.id, BigInt(program.id))).executeSync()[0]!;
	expect(row.program_name).toBe('Updated');
	expect(row.membership_number).toBe('UA999');
	expect(Number(row.balance)).toBe(5000);
	expect(row.notes).toBe('After flight');

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	// create (called directly from setup) no longer logs from the repo;
	// only the route action logs. So just the update audit row.
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('loyalty_program_update');
	expect(Number(logs[0].entity_id)).toBe(program.id);
});

test('update action re-stamps balance_updated_at only when balance changes', async () => {
	const user = makeUserLocals(ctx.kit);
	const program = createLoyaltyProgram(user.user.id, { programName: 'AA', balance: 1000 });
	const originalStamp = ctx.kit
		.selectFrom(loyaltyPrograms)
		.where(kitEq(loyaltyPrograms.id, BigInt(program.id)))
		.executeSync()[0]!.balance_updated_at;
	expect(originalStamp).not.toBeNull();

	// Wait a tick so the timestamp would differ if re-stamped
	await new Promise((r) => setTimeout(r, 10));

	// Same balance — should NOT re-stamp
	const same = new FormData();
	same.set('programName', 'AA');
	same.set('balance', '1000');
	await expect(actions.update(event(user.user, { id: String(program.id) }, same))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);
	const afterSame = ctx.kit
		.selectFrom(loyaltyPrograms)
		.where(kitEq(loyaltyPrograms.id, BigInt(program.id)))
		.executeSync()[0]!.balance_updated_at;
	expect(afterSame).toBe(originalStamp);

	await new Promise((r) => setTimeout(r, 10));

	// Different balance — SHOULD re-stamp
	const changed = new FormData();
	changed.set('programName', 'AA');
	changed.set('balance', '2000');
	await expect(actions.update(event(user.user, { id: String(program.id) }, changed))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);
	const afterChanged = ctx.kit
		.selectFrom(loyaltyPrograms)
		.where(kitEq(loyaltyPrograms.id, BigInt(program.id)))
		.executeSync()[0]!.balance_updated_at;
	expect(afterChanged).not.toBe(originalStamp);
});

test('update action cannot modify another users program', async () => {
	const owner = makeUserLocals(ctx.kit);
	const other = makeUser(ctx.kit, { email: 'other@x.c' });
	const program = createLoyaltyProgram(owner.user.id, { programName: 'Owner only' });

	const f = new FormData();
	f.set('programName', 'Hacked');
	await expect(actions.update(event(other, { id: String(program.id) }, f))).rejects.toMatchObject({
		status: 404
	});

	const row = ctx.kit.selectFrom(loyaltyPrograms).where(kitEq(loyaltyPrograms.id, BigInt(program.id))).executeSync()[0]!;
	expect(row.program_name).toBe('Owner only');
});

test('update action rate limits', async () => {
	const user = makeUserLocals(ctx.kit);
	const program = createLoyaltyProgram(user.user.id, { programName: 'X' });
	for (let i = 0; i < 10; i++) {
		const f = new FormData();
		f.set('programName', `X${i}`);
		await expect(actions.update(event(user.user, { id: String(program.id) }, f))).rejects.toEqual(
			expect.objectContaining({ status: 303 })
		);
	}

	const f = new FormData();
	f.set('programName', 'Blocked');
	const result = (await actions.update(event(user.user, { id: String(program.id) }, f))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(429);
});
