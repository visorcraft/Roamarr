import { test, expect, vi, beforeEach } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

beforeEach(() => {
	ctx.kit.deleteFrom(reminders).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	ctx.kit.deleteFrom(trips).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

import { DELETE } from './+server';
import { reminders, auditLogs, trips, users } from '$lib/server/db/mongrelSchema';
import { kit } from '$lib/server/db';
import { makeUser } from '../../../../../tests/helpers';
import { resetRateLimit } from '$lib/server/rateLimit';

function makeEvent(params: Record<string, string>, user: unknown) {
	return {
		params,
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

function insertReminder(userId: number, over: any = {}) {
	return kit.insertInto(reminders).values({
		user_id: BigInt(userId),
		kind: over.kind ?? 'custom',
		ref_type: over.refType ?? 'trip',
		ref_id: BigInt(over.refId ?? 0),
		fire_at: over.fireAt ?? '2026-01-01T00:00:00Z',
		status: over.status ?? 'pending',
		attempts: BigInt(0),
		sent_at: null,
		name: over.name ?? null,
		description: over.description ?? null
	}).executeSync();
}

test('delete removes an owned reminder, logs audit, and returns 204', async () => {
	const user = makeUser(ctx.kit);
	const r = insertReminder(user.id, { name: 'Pack' });

	const res = await DELETE(makeEvent({ id: String(r.id) }, user));
	expect(res.status).toBe(204);
	expect(kit.selectFrom(reminders).executeSync()).toHaveLength(0);

	const logs = kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('reminder_delete');
	expect(logs[0].entity_type).toBe('reminder');
});

test('delete returns 404 for another users reminder', async () => {
	const a = makeUser(ctx.kit);
	const b = makeUser(ctx.kit, { email: 'b@x.c' });
	const r = insertReminder(a.id, { name: 'Pack' });

	await expect(DELETE(makeEvent({ id: String(r.id) }, b))).rejects.toMatchObject({ status: 404 });
	expect(kit.selectFrom(reminders).executeSync()).toHaveLength(1);
});

test('delete rejects unauthenticated request', async () => {
	await expect(DELETE(makeEvent({ id: '1' }, null))).rejects.toMatchObject({ status: 401 });
});
