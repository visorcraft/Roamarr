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

function event(user: { id: number } | null, body?: FormData) {
	return {
		locals: { user } as App.Locals,
		request: body ? ({ formData: async () => body } as Request) : undefined
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
