import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
const delivered = vi.hoisted(() => [] as Array<{ uid: number; m: any }>);
vi.mock('./notify', () => ({
	deliver: async (uid: number, m: any) => delivered.push({ uid, m })
}));

import { upsertRemindersForSegment, cancelRemindersFor, runDueReminders } from './reminders';
import { users, trips, segments, reminders } from './db/schema';

let owner: any;
let trip: any;

beforeEach(() => {
	(ctx as { sqlite: import('better-sqlite3').Database }).sqlite.exec(
		'delete from reminders; delete from segments; delete from trips; delete from users;'
	);
	delivered.length = 0;
	const db = (ctx as { db: import('./db').DB }).db;
	owner = db
		.insert(users)
		.values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	trip = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();
});

test('arms a pending reminder 24h before a future flight', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const seg = db
		.insert(segments)
		.values({
			tripId: trip.id,
			type: 'flight',
			title: 'UA1',
			startAt: '2099-01-02T00:00:00.000Z',
			startTz: 'UTC'
		})
		.returning()
		.get();
	upsertRemindersForSegment(seg);
	const r = db.select().from(reminders).get();
	expect(r!.fireAt).toBe('2099-01-01T00:00:00.000Z');
	expect(r!.status).toBe('pending');
});

test('atomic run delivers due, marks sent, no double-deliver on re-run', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const seg = db
		.insert(segments)
		.values({
			tripId: trip.id,
			type: 'flight',
			title: 'UA1',
			startAt: '2000-01-02T00:00:00.000Z',
			startTz: 'UTC'
		})
		.returning()
		.get();
	upsertRemindersForSegment(seg);
	db.update(reminders).set({ status: 'pending' }).run();
	await runDueReminders(new Date('2000-02-01T00:00:00Z'));
	await runDueReminders(new Date('2000-02-01T00:00:00Z'));
	expect(delivered.length).toBe(1);
	expect(db.select().from(reminders).get()!.status).toBe('sent');
});

test('cancel removes the reminder', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const seg = db
		.insert(segments)
		.values({
			tripId: trip.id,
			type: 'flight',
			title: 'UA1',
			startAt: '2099-01-02T00:00:00.000Z',
			startTz: 'UTC'
		})
		.returning()
		.get();
	upsertRemindersForSegment(seg);
	cancelRemindersFor('segment', seg.id);
	expect(db.select().from(reminders).all().length).toBe(0);
});
