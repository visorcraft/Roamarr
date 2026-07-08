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
import { makeUser } from '../../../../../../tests/helpers';

function insertReminder(userId: number, over: any = {}) {
	return ctx.kit.insertInto(reminders).values({
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

function event(
	user: { id: number; timezone?: string } | null,
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

test('load returns 404 for missing or non-owned reminder', () => {
	const user = makeUser(ctx.kit);
	expect(() => load(event({ id: user.id }, { id: '999' }))).toThrow(
		expect.objectContaining({ status: 404 })
	);
});

test('load returns reminder + linked trip name', () => {
	const user = makeUser(ctx.kit);
	const trip = ctx.kit.insertInto(trips).values({
		owner_id: BigInt(user.id),
		name: 'Summer',
		tags: '[]',
		public_token: 'pub-x',
		calendar_token: 'cal-x',
		base_currency: 'USD',
		status: 'booked'
	}).executeSync();
	const r = insertReminder(user.id, { refType: 'trip', refId: Number(trip.id), name: 'Pack' });

	const result = load(event({ id: user.id }, { id: String(r.id) })) as {
		reminder: { id: number; name: string };
		linkedName: string | null;
	};
	expect(result.reminder.id).toBe(Number(r.id));
	expect(result.linkedName).toBe('Summer');
});

test('update action edits name/description/fireAt and redirects', async () => {
	const user = makeUser(ctx.kit, { timezone: 'UTC' });
	const r = insertReminder(user.id, { name: 'Old', fireAt: '2026-01-01T00:00:00Z' });

	const f = new FormData();
	f.set('name', 'Renamed');
	f.set('description', 'Updated notes');
	f.set('fireAt', '2026-09-01T08:00');

	await expect(actions.update(event({ id: user.id, timezone: 'UTC' }, { id: String(r.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const row = ctx.kit.selectFrom(reminders).where(kitEq(reminders.id, BigInt(r.id))).executeSync()[0]!;
	expect(row.name).toBe('Renamed');
	expect(row.description).toBe('Updated notes');
	expect(row.fire_at).toBe('2026-09-01T08:00:00.000Z');

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('reminder_update');
});

test('update action NEVER resets status or sent_at on a fired reminder', async () => {
	const user = makeUser(ctx.kit, { timezone: 'UTC' });
	const r = insertReminder(user.id, {
		name: 'Already Fired',
		fireAt: '2025-01-01T00:00:00Z',
		status: 'sent',
		sentAt: '2025-01-01T00:00:05.000Z',
		attempts: 1
	});

	const f = new FormData();
	f.set('name', 'Renamed after firing');
	f.set('fireAt', '2030-01-01T00:00'); // user tries to push to far future
	await expect(actions.update(event({ id: user.id, timezone: 'UTC' }, { id: String(r.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const row = ctx.kit.selectFrom(reminders).where(kitEq(reminders.id, BigInt(r.id))).executeSync()[0]!;
	expect(row.name).toBe('Renamed after firing');
	expect(row.fire_at).toBe('2030-01-01T00:00:00.000Z'); // fireAt updated
	// But the safety invariant: status/sentAt/attempts MUST be untouched.
	expect(row.status).toBe('sent');
	expect(row.sent_at).toBe('2025-01-01T00:00:05.000Z');
	expect(Number(row.attempts)).toBe(1);
});

test('update action cannot edit another users reminder', async () => {
	const a = makeUser(ctx.kit);
	const b = makeUser(ctx.kit, { email: 'b@x.c' });
	const r = insertReminder(a.id, { name: 'A only' });

	const f = new FormData();
	f.set('name', 'Hacked');
	f.set('fireAt', '2026-09-01T08:00');
	await expect(actions.update(event({ id: b.id, timezone: 'UTC' }, { id: String(r.id) }, f))).rejects.toMatchObject({
		status: 404
	});

	const row = ctx.kit.selectFrom(reminders).where(kitEq(reminders.id, BigInt(r.id))).executeSync()[0]!;
	expect(row.name).toBe('A only');
});

test('update action preserves system-managed refId', async () => {
	const user = makeUser(ctx.kit);
	const trip = ctx.kit.insertInto(trips).values({
		owner_id: BigInt(user.id),
		name: 'Trip',
		tags: '[]',
		public_token: 'pub-x',
		calendar_token: 'cal-x',
		base_currency: 'USD',
		status: 'booked'
	}).executeSync();
	const r = insertReminder(user.id, {
		kind: 'flight_checkin',
		refType: 'segment',
		refId: Number(trip.id),
		name: null
	});

	// Even if the form posts a different refId, system reminders ignore it
	const f = new FormData();
	f.set('name', 'Renamed');
	f.set('fireAt', '2026-09-01T08:00');
	f.set('refId', '99999');
	await expect(actions.update(event({ id: user.id, timezone: 'UTC' }, { id: String(r.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const row = ctx.kit.selectFrom(reminders).where(kitEq(reminders.id, BigInt(r.id))).executeSync()[0]!;
	expect(Number(row.ref_id)).toBe(Number(trip.id));
});

test('update action clears refId on custom reminder when none provided', async () => {
	const user = makeUser(ctx.kit);
	const r = insertReminder(user.id, { kind: 'custom', refType: 'trip', refId: 42, name: 'Custom' });

	const f = new FormData();
	f.set('name', 'Custom');
	f.set('fireAt', '2026-09-01T08:00');
	f.set('refId', '');
	await expect(actions.update(event({ id: user.id, timezone: 'UTC' }, { id: String(r.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const row = ctx.kit.selectFrom(reminders).where(kitEq(reminders.id, BigInt(r.id))).executeSync()[0]!;
	expect(Number(row.ref_id)).toBe(0);
});

test('update action rate limits', async () => {
	const user = makeUser(ctx.kit);
	const r = insertReminder(user.id, { name: 'R' });
	for (let i = 0; i < 10; i++) {
		const f = new FormData();
		f.set('name', `R${i}`);
		f.set('fireAt', '2026-09-01T08:00');
		await expect(actions.update(event({ id: user.id, timezone: 'UTC' }, { id: String(r.id) }, f))).rejects.toEqual(
			expect.objectContaining({ status: 303 })
		);
	}

	const f = new FormData();
	f.set('name', 'Blocked');
	f.set('fireAt', '2026-09-01T08:00');
	const result = (await actions.update(event({ id: user.id, timezone: 'UTC' }, { id: String(r.id) }, f))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(429);
});
