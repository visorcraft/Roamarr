import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

beforeEach(() => {
	ctx.kit.deleteFrom(reminders).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

import { GET } from './+server';
import { reminders, users } from '$lib/server/db/mongrelSchema';
import { makeUser } from '../../../../tests/helpers';
import { resetRateLimit } from '$lib/server/rateLimit';

function makeEvent(url: string, user: unknown) {
	return {
		url: new URL(url, 'http://localhost'),
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

function insertReminder(kit: any, userId: number, over: any = {}) {
	return kit.insertInto(reminders).values({
		user_id: BigInt(userId),
		kind: over.kind ?? 'custom',
		ref_type: over.refType ?? 'trip',
		ref_id: BigInt(over.refId ?? 0),
		fire_at: over.fireAt ?? '2026-01-01T00:00:00Z',
		status: over.status ?? 'pending',
		attempts: BigInt(over.attempts ?? 0),
		sent_at: over.sentAt ?? null,
		name: over.name ?? null,
		description: over.description ?? null
	}).executeSync();
}

test('returns paginated reminders for the signed-in user', async () => {
	const user = makeUser(ctx.kit);
	insertReminder(ctx.kit, user.id, { name: 'Pack', fireAt: '2026-02-01T00:00:00Z' });
	insertReminder(ctx.kit, user.id, { name: 'Renew', fireAt: '2026-03-01T00:00:00Z' });

	const res = await GET(makeEvent('/api/reminders', user));
	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body.total).toBe(2);
	expect(body.rows).toHaveLength(2);
	expect(body.rows[0]).toMatchObject({ name: 'Pack' });
});

test('does not expose other users reminders', async () => {
	const a = makeUser(ctx.kit);
	const b = makeUser(ctx.kit, { email: 'b@x.c' });
	insertReminder(ctx.kit, a.id, { name: 'A only' });

	const res = await GET(makeEvent('/api/reminders', b));
	const body = await res.json();
	expect(body.total).toBe(0);
	expect(body.rows).toEqual([]);
});

test('rejects unauthenticated requests', async () => {
	await expect(GET(makeEvent('/api/reminders', null))).rejects.toMatchObject({ status: 401 });
});

test('filters by date range on fire_at', async () => {
	const user = makeUser(ctx.kit);
	insertReminder(ctx.kit, user.id, { name: 'jan', fireAt: '2026-01-15T00:00:00Z' });
	insertReminder(ctx.kit, user.id, { name: 'feb', fireAt: '2026-02-15T00:00:00Z' });
	insertReminder(ctx.kit, user.id, { name: 'mar', fireAt: '2026-03-15T00:00:00Z' });

	const res = await GET(makeEvent('/api/reminders?from=2026-02-01&to=2026-02-28', user));
	const body = await res.json();
	expect(body.total).toBe(1);
	expect(body.rows[0].name).toBe('feb');
});

test('search filters by name', async () => {
	const user = makeUser(ctx.kit);
	insertReminder(ctx.kit, user.id, { name: 'Pack for Tokyo' });
	insertReminder(ctx.kit, user.id, { name: 'Renew passport' });

	const res = await GET(makeEvent('/api/reminders?search=tokyo', user));
	const body = await res.json();
	expect(body.total).toBe(1);
	expect(body.rows[0].name).toBe('Pack for Tokyo');
});

test('rate limits repeated requests', async () => {
	const user = makeUser(ctx.kit);
	for (let i = 0; i < 10; i++) {
		const res = await GET(makeEvent('/api/reminders', user));
		expect(res.status).toBe(200);
	}
	await expect(GET(makeEvent('/api/reminders', user))).rejects.toMatchObject({ status: 429 });
});
