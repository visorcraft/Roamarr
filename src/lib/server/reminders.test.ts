import { test, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

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

import {
	upsertRemindersForSegment,
	upsertRemindersForDocument,
	upsertCustomReminder,
	cancelRemindersFor,
	runDueReminders
} from './reminders';
import { users, trips, segments, reminders, travelDocuments } from './db/schema';

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

test('reclaims a reminder orphaned in "sending" by a prior crash', async () => {
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
	// Simulate a crash mid-delivery: the row is stuck in 'sending', never sent.
	db.update(reminders).set({ status: 'sending' }).run();
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

test('non-flight segments do not arm reminders', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	for (const type of ['hotel', 'rental_car', 'train', 'poi', 'boat'] as const) {
		const seg = db
			.insert(segments)
			.values({
				tripId: trip.id,
				type,
				title: type,
				startAt: '2099-01-02T00:00:00.000Z',
				startTz: 'UTC'
			})
			.returning()
			.get();
		upsertRemindersForSegment(seg);
	}
	expect(db.select().from(reminders).all().length).toBe(0);
});

test('changing a flight to a non-flight cancels its reminder', () => {
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
	expect(db.select().from(reminders).all().length).toBe(1);

	const lodging = { ...seg, type: 'hotel' as const };
	upsertRemindersForSegment(lodging);
	expect(db.select().from(reminders).all().length).toBe(0);
});

test('arms a reminder using the owners configured flight check-in lead', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	db.update(users).set({ flightCheckinLeadHours: 48 }).where(eq(users.id, owner.id)).run();
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
	expect(r!.fireAt).toBe('2098-12-31T00:00:00.000Z');
});

test('arms a reminder using the owners configured document expiry lead', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	db.update(users)
		.set({ timezone: 'America/New_York', documentExpiryLeadDays: 30 })
		.where(eq(users.id, owner.id))
		.run();
	const doc = db
		.insert(travelDocuments)
		.values({
			userId: owner.id,
			type: 'passport',
			expiresOn: '2026-12-30'
		})
		.returning()
		.get();
	upsertRemindersForDocument(doc);
	const r = db.select().from(reminders).get();
	expect(r!.fireAt).toBe('2026-11-30T14:00:00.000Z');
});

test('custom reminder arms before a trip start', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const t = db
		.insert(trips)
		.values({ ownerId: owner.id, name: 'Custom', startDate: '2099-06-01' })
		.returning()
		.get();
	upsertCustomReminder(owner.id, 'trip', t.id, `${t.startDate}T09:00:00Z`, 1440);
	const rows = db.select().from(reminders).where(eq(reminders.refType, 'trip')).all();
	expect(rows).toHaveLength(1);
	expect(rows[0].kind).toBe('custom');
	expect(rows[0].fireAt).toBe('2099-05-31T09:00:00.000Z');
});
