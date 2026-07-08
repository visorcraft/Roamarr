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
	ctx.kit.deleteFrom(reminders).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	ctx.kit.deleteFrom(trips).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

afterAll(() => {
	ctx.close();
});

import { load, actions } from './+page.server';
import { reminders, auditLogs, trips, users } from '$lib/server/db/mongrelSchema';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { makeUser } from '../../../../../tests/helpers';

function event(user: { id: number; timezone?: string } | null, body?: FormData, clientAddress = '127.0.0.1') {
	return {
		locals: { user } as App.Locals,
		request: body ? ({ formData: async () => body } as Request) : undefined,
		getClientAddress: () => clientAddress
	} as any;
}

test('load requires a signed-in user', () => {
	expect(() => load(event(null))).toThrow(expect.objectContaining({ status: 401 }));
});

test('load returns the users timezone', () => {
	const user = makeUser(ctx.kit, { timezone: 'America/New_York' });
	const result = load(event({ id: user.id, timezone: user.timezone })) as { timezone: string };
	expect(result.timezone).toBe('America/New_York');
});

test('create action adds a custom reminder with name+description, logs audit, redirects', async () => {
	const user = makeUser(ctx.kit, { timezone: 'UTC' });
	const f = new FormData();
	f.set('reminderType', 'trip');
	f.set('name', 'Pack for Tokyo');
	f.set('description', 'Pack winter clothes');
	f.set('fireAt', '2026-02-01T09:00');

	await expect(actions.create(event({ id: user.id, timezone: 'UTC' }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(reminders).where(kitEq(reminders.user_id, BigInt(user.id))).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].kind).toBe('custom');
	expect(rows[0].ref_type).toBe('trip');
	expect(rows[0].name).toBe('Pack for Tokyo');
	expect(rows[0].description).toBe('Pack winter clothes');
	expect(rows[0].fire_at).toBe('2026-02-01T09:00:00.000Z');
	expect(rows[0].status).toBe('pending');

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('reminder_create');
	expect(logs[0].entity_type).toBe('reminder');
});

test('create action respects user timezone for fireAt', async () => {
	const user = makeUser(ctx.kit, { timezone: 'America/New_York' });
	const f = new FormData();
	f.set('reminderType', 'document');
	f.set('name', 'Renew passport');
	f.set('fireAt', '2026-07-04T09:00'); // 9 AM local

	await expect(actions.create(event({ id: user.id, timezone: 'America/New_York' }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(reminders).executeSync();
	// 2026-07-04T09:00 America/New_York (EDT = UTC-4) → 2026-07-04T13:00 UTC
	expect(rows[0].fire_at).toBe('2026-07-04T13:00:00.000Z');
});

test('create action requires name and fireAt', async () => {
	const user = makeUser(ctx.kit);

	const f = new FormData();
	f.set('reminderType', 'trip');
	f.set('fireAt', '2026-02-01T09:00');
	const result = (await actions.create(event({ id: user.id, timezone: 'UTC' }, f))) as {
		status: number;
		data: { error: string; errors: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.name).toBe('name is required');
	expect(ctx.kit.selectFrom(reminders).executeSync()).toHaveLength(0);

	const f2 = new FormData();
	f2.set('reminderType', 'trip');
	f2.set('name', 'Pack');
	const result2 = (await actions.create(event({ id: user.id, timezone: 'UTC' }, f2))) as {
		status: number;
		data: { error: string; errors: Record<string, string> };
	};
	expect(result2.status).toBe(400);
	expect(result2.data.errors.fireAt).toBe('fireAt is required');
});

test('create action rejects bad reminderType', async () => {
	const user = makeUser(ctx.kit);
	const f = new FormData();
	f.set('reminderType', 'banana');
	f.set('name', 'X');
	f.set('fireAt', '2026-02-01T09:00');

	const result = (await actions.create(event({ id: user.id, timezone: 'UTC' }, f))) as {
		status: number;
		data: { errors: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.reminderType).toBe('Pick Trip or Document');
});

test('create action accepts no ref (refId stays 0)', async () => {
	const user = makeUser(ctx.kit);
	const f = new FormData();
	f.set('reminderType', 'trip');
	f.set('name', 'Freeform');
	f.set('fireAt', '2026-02-01T09:00');

	await expect(actions.create(event({ id: user.id, timezone: 'UTC' }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(reminders).executeSync();
	expect(rows).toHaveLength(1);
	expect(Number(rows[0].ref_id)).toBe(0);
});

test('create action rate limits', async () => {
	const user = makeUser(ctx.kit);
	for (let i = 0; i < 10; i++) {
		const f = new FormData();
		f.set('reminderType', 'trip');
		f.set('name', `R${i}`);
		f.set('fireAt', '2026-02-01T09:00');
		await expect(actions.create(event({ id: user.id, timezone: 'UTC' }, f))).rejects.toEqual(
			expect.objectContaining({ status: 303 })
		);
	}

	const f = new FormData();
	f.set('reminderType', 'trip');
	f.set('name', 'Blocked');
	f.set('fireAt', '2026-02-01T09:00');
	const result = (await actions.create(event({ id: user.id, timezone: 'UTC' }, f))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(429);
});
