import { test, expect, vi, beforeEach, afterAll } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';
import { resetRateLimit } from '$lib/server/rateLimit';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

beforeEach(() => {
	ctx.kit.deleteFrom(groups).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

afterAll(() => {
	ctx.close();
});

import { load, actions } from './+page.server';
import { groups, auditLogs, users } from '$lib/server/db/mongrelSchema';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { makeUserLocals } from '../../../../tests/eventHelpers';

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

test('create action adds a group, logs audit, and redirects', async () => {
	const user = makeUserLocals(ctx.kit);
	const f = new FormData();
	f.set('name', 'Family');

	await expect(actions.create(event(user.user, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(groups).where(kitEq(groups.owner_id, BigInt(user.user.id))).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].name).toBe('Family');

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('group_create');
	expect(logs[0].entity_type).toBe('group');
	expect(Number(logs[0].entity_id)).toBe(Number(rows[0].id));
});

test('create action rejects empty or whitespace-only names and preserves values', async () => {
	const user = makeUserLocals(ctx.kit);
	const f = new FormData();
	f.set('name', '   ');

	const result = (await actions.create(event(user.user, f))) as {
		status: number;
		data: { error: string; errors: Record<string, string>; values: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.error).toBe('Please fix the highlighted fields.');
	expect(result.data.errors).toEqual({ name: 'name is required' });
	expect(result.data.values).toEqual({ name: '   ' });

	expect(ctx.kit.selectFrom(groups).executeSync()).toHaveLength(0);
	expect(ctx.kit.selectFrom(auditLogs).executeSync()).toHaveLength(0);
});

test('create action rejects names over 200 characters and preserves values', async () => {
	const user = makeUserLocals(ctx.kit);
	const longName = 'a'.repeat(201);
	const f = new FormData();
	f.set('name', longName);

	const result = (await actions.create(event(user.user, f))) as {
		status: number;
		data: { error: string; errors: Record<string, string>; values: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.error).toBe('Please fix the highlighted fields.');
	expect(result.data.errors).toEqual({ name: 'name must be at most 200 characters' });
	expect(result.data.values).toEqual({ name: longName });

	expect(ctx.kit.selectFrom(groups).executeSync()).toHaveLength(0);
});

test('create action rate limits repeated requests', async () => {
	const user = makeUserLocals(ctx.kit);
	for (let i = 0; i < 10; i++) {
		const f = new FormData();
		f.set('name', `Group ${i}`);
		await expect(actions.create(event(user.user, f))).rejects.toEqual(
			expect.objectContaining({ status: 303 })
		);
	}

	const f = new FormData();
	f.set('name', 'Last');
	const result = (await actions.create(event(user.user, f))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(429);
	expect(result.data.error).toBe('Too many attempts. Try again later.');
});
