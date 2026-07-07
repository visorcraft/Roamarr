import { test, expect, vi, beforeEach, afterAll } from 'vitest';

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
	ctx.kit.deleteFrom(cards).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
});

afterAll(() => {
	ctx.close();
});

import { load, actions } from './+page.server';
import { cards, auditLogs, users } from '$lib/server/db/mongrelSchema';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { makeUserLocals } from '../../../../tests/eventHelpers';

function event(user: { id: number } | null, body?: FormData) {
	return {
		locals: { user } as App.Locals,
		request: body ? ({ formData: async () => body } as Request) : undefined
	} as any;
}

test('load requires a signed-in user', () => {
	expect(() => load(event(null))).toThrow(expect.objectContaining({ status: 401 }));
});

test('create action adds a card, logs audit, and redirects', async () => {
	const user = makeUserLocals(ctx.kit);
	const f = new FormData();
	f.set('nickname', 'Sapphire Reserve');
	f.set('network', 'visa');
	f.set('last4', '1234');
	f.set('notes', 'Primary card');

	await expect(actions.create(event(user.user, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(cards).where(kitEq(cards.user_id, BigInt(user.user.id))).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].nickname).toBe('Sapphire Reserve');
	expect(rows[0].network).toBe('visa');
	expect(rows[0].last4).toBe('1234');
	expect(rows[0].notes).toBe('Primary card');

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('card_create');
	expect(logs[0].entity_type).toBe('card');
	expect(Number(logs[0].entity_id)).toBe(Number(rows[0].id));
});

test('create action rejects empty nickname or unsupported network with errors object', async () => {
	const user = makeUserLocals(ctx.kit);

	const emptyNickname = new FormData();
	emptyNickname.set('nickname', '');
	emptyNickname.set('network', 'visa');
	const emptyResult = (await actions.create(event(user.user, emptyNickname))) as {
		status: number;
		data: { error: string; errors: Record<string, string>; values?: Record<string, unknown> };
	};
	expect(emptyResult.status).toBe(400);
	expect(emptyResult.data.errors.nickname).toBe('nickname is required');
	expect(emptyResult.data.values?.nickname).toBe('');

	const badNetwork = new FormData();
	badNetwork.set('nickname', 'Sapphire');
	badNetwork.set('network', 'jcb');
	const networkResult = (await actions.create(event(user.user, badNetwork))) as {
		status: number;
		data: { error: string; errors: Record<string, string>; values?: Record<string, unknown> };
	};
	expect(networkResult.status).toBe(400);
	expect(networkResult.data.errors.network).toContain('visa');
	expect(networkResult.data.values?.network).toBe('jcb');

	const rows = ctx.kit.selectFrom(cards).where(kitEq(cards.user_id, BigInt(user.user.id))).executeSync();
	expect(rows).toHaveLength(0);
});

test('create action rejects nickname and notes that exceed max length', async () => {
	const user = makeUserLocals(ctx.kit);

	const f = new FormData();
	f.set('nickname', 'x'.repeat(201));
	f.set('network', 'visa');
	f.set('notes', 'x'.repeat(2001));
	const result = (await actions.create(event(user.user, f))) as {
		status: number;
		data: { error: string; errors: Record<string, string>; values?: Record<string, unknown> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.nickname).toBe('nickname must be at most 200 characters');
	expect(result.data.errors.notes).toBe('notes must be at most 2000 characters');

	const rows = ctx.kit.selectFrom(cards).where(kitEq(cards.user_id, BigInt(user.user.id))).executeSync();
	expect(rows).toHaveLength(0);
});
