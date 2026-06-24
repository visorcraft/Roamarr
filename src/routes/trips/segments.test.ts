import { and, eq } from 'drizzle-orm';
import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _addSegment as addSegment, _updateSegment as updateSegment } from './[id]/segments/+page.server';
import { users, trips, cards, segments, reminders } from '$lib/server/db/schema';

test('flight start_at is stored as a UTC instant; foreign card rejected', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const b = db
		.insert(users)
		.values({ email: 'b@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	const bCard = db
		.insert(cards)
		.values({ userId: b.id, nickname: 'B', network: 'visa' })
		.returning()
		.get();
	addSegment(a.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'America/New_York'
	});
	expect(db.select().from(segments).get()!.startAt).toBe('2026-07-01T19:00:00.000Z');
	expect(() =>
		addSegment(a.id, t.id, {
			type: 'flight',
			title: 'X',
			localStart: '2026-07-01T15:00:00',
			startTz: 'UTC',
			cardId: bCard.id
		})
	).toThrow();
});

test('update segment edits fields and re-arms reminders when flight time changes', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'update-a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	const seg = addSegment(a.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'America/New_York'
	});
	const initialReminder = db
		.select()
		.from(reminders)
		.where(and(eq(reminders.refType, 'segment'), eq(reminders.refId, seg.id)))
		.get();
	expect(initialReminder).toBeTruthy();
	expect(initialReminder!.fireAt).toBe('2026-06-30T19:00:00.000Z');

	const updated = updateSegment(a.id, t.id, seg.id, {
		title: 'UA1 Rerouted',
		localStart: '2026-07-02T10:00:00',
		startTz: 'America/New_York',
		location: 'JFK → LHR',
		confirmationNumber: 'ABC789',
		details: { gate: 'A1' }
	});
	expect(updated.title).toBe('UA1 Rerouted');
	expect(updated.startAt).toBe('2026-07-02T14:00:00.000Z');
	expect(updated.location).toBe('JFK → LHR');
	expect(updated.confirmationNumber).toBe('ABC789');
	expect(updated.detailsJson).toBe('{"gate":"A1"}');

	const rearmed = db
		.select()
		.from(reminders)
		.where(and(eq(reminders.refType, 'segment'), eq(reminders.refId, seg.id)))
		.get();
	expect(rearmed).toBeTruthy();
	expect(rearmed!.fireAt).toBe('2026-07-01T14:00:00.000Z');
});

test('update segment is ownership-checked', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'owner-a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const b = db
		.insert(users)
		.values({ email: 'owner-b@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	const otherTrip = db.insert(trips).values({ ownerId: b.id, name: 'O' }).returning().get();
	const seg = addSegment(a.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'UTC'
	});

	expect(() =>
		updateSegment(b.id, t.id, seg.id, {
			title: 'Hacked',
			localStart: '2026-07-01T15:00:00',
			startTz: 'UTC'
		})
	).toThrow();
	expect(() =>
		updateSegment(a.id, otherTrip.id, seg.id, {
			title: 'Hacked',
			localStart: '2026-07-01T15:00:00',
			startTz: 'UTC'
		})
	).toThrow();
});
