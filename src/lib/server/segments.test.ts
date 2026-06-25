import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { addSegment, updateSegment, hasOverlappingSegment, duplicateSegment, updateSegmentStatus, setSegmentStatus } from './segments';
import { users, trips, segments, cards, auditLogs } from './db/schema';
import { eq } from 'drizzle-orm';

test('detects overlap with existing segment', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'o@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	db.insert(segments)
		.values({
			tripId: t.id,
			type: 'flight',
			title: 'A',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC',
			endAt: '2026-01-01T12:00:00Z'
		})
		.run();

	expect(hasOverlappingSegment(t.id, undefined, '2026-01-01T11:00:00Z', '2026-01-01T13:00:00Z')).toBe(true);
	expect(hasOverlappingSegment(t.id, undefined, '2026-01-01T13:00:00Z', '2026-01-01T14:00:00Z')).toBe(false);
});

test('excluding current segment avoids self-overlap', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'o2@x.c', passwordHash: 'x', displayName: 'O2' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const s = db.insert(segments)
		.values({
			tripId: t.id,
			type: 'flight',
			title: 'A',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC',
			endAt: '2026-01-01T12:00:00Z'
		})
		.returning()
		.get();

	expect(hasOverlappingSegment(t.id, s.id, '2026-01-01T10:00:00Z', '2026-01-01T12:00:00Z')).toBe(false);
});

test('duplicateSegment copies a segment shifted 24 hours and clears confirmation', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'dup@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const c = db
		.insert(cards)
		.values({ userId: u.id, nickname: 'Travel', network: 'visa', last4: '1234' })
		.returning()
		.get();
	const s = db
		.insert(segments)
		.values({
			tripId: t.id,
			type: 'shuttle',
			title: 'Airport shuttle',
			startAt: '2026-07-01T09:00:00Z',
			startTz: 'America/New_York',
			endAt: '2026-07-01T10:00:00Z',
			location: 'JFK',
			confirmationNumber: 'ABC123',
			cardId: c.id,
			detailsJson: JSON.stringify({ note: 'x' })
		})
		.returning()
		.get();

	const copy = duplicateSegment(u.id, t.id, s.id);
	expect(copy.id).not.toBe(s.id);
	expect(copy.type).toBe(s.type);
	expect(copy.title).toBe(s.title);
	expect(copy.location).toBe(s.location);
	expect(copy.startTz).toBe(s.startTz);
	expect(copy.endTz).toBe(s.startTz);
	expect(copy.startAt).toBe('2026-07-02T09:00:00.000Z');
	expect(copy.endAt).toBe('2026-07-02T10:00:00.000Z');
	expect(copy.confirmationNumber).toBeNull();
	expect(copy.cardId).toBe(c.id);
	expect(copy.detailsJson).toBe(s.detailsJson);

	const rows = db.select().from(segments).where(eq(segments.tripId, t.id)).all();
	expect(rows).toHaveLength(2);

	const logs = db.select().from(auditLogs).where(eq(auditLogs.entityId, copy.id)).all();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('duplicate');
	expect(logs[0].entityType).toBe('segment');
});

test('duplicateSegment rejects a segment from another trip or non-editor', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const owner = db.insert(users).values({ email: 'dup-owner@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const other = db.insert(users).values({ email: 'dup-other@x.c', passwordHash: 'x', displayName: 'X' }).returning().get();
	const t1 = db.insert(trips).values({ ownerId: owner.id, name: 'T1' }).returning().get();
	const t2 = db.insert(trips).values({ ownerId: owner.id, name: 'T2' }).returning().get();
	const s = db
		.insert(segments)
		.values({
			tripId: t1.id,
			type: 'flight',
			title: 'A',
			startAt: '2026-08-01T08:00:00Z',
			startTz: 'UTC'
		})
		.returning()
		.get();

	expect(() => duplicateSegment(owner.id, t2.id, s.id)).toThrow();
	expect(() => duplicateSegment(other.id, t1.id, s.id)).toThrow();
});

test('addSegment stores meeting point and rally time as UTC', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'meet@x.c', passwordHash: 'x', displayName: 'M' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	const seg = addSegment(u.id, t.id, {
		type: 'meetup',
		title: 'Coffee',
		localStart: '2026-09-01T10:00:00',
		startTz: 'America/New_York',
		meetingPoint: 'Hotel lobby',
		meetingAt: '2026-09-01T09:30:00'
	});
	expect(seg.meetingPoint).toBe('Hotel lobby');
	expect(seg.meetingAt).toBe('2026-09-01T13:30:00.000Z');
});

test('updateSegment stores and clears meeting info', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'meet-update@x.c', passwordHash: 'x', displayName: 'M' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const seg = addSegment(u.id, t.id, {
		type: 'meetup',
		title: 'Coffee',
		localStart: '2026-09-01T10:00:00',
		startTz: 'America/New_York'
	});

	const withMeeting = updateSegment(u.id, t.id, seg.id, {
		title: 'Coffee',
		localStart: '2026-09-01T10:00:00',
		startTz: 'America/New_York',
		meetingPoint: 'Lobby entrance',
		meetingAt: '2026-09-01T09:15:00'
	});
	expect(withMeeting.meetingPoint).toBe('Lobby entrance');
	expect(withMeeting.meetingAt).toBe('2026-09-01T13:15:00.000Z');

	const cleared = updateSegment(u.id, t.id, seg.id, {
		title: 'Coffee',
		localStart: '2026-09-01T10:00:00',
		startTz: 'America/New_York'
	});
	expect(cleared.meetingPoint).toBeNull();
	expect(cleared.meetingAt).toBeNull();
});

test('duplicateSegment copies meeting point and shifts rally time by 24h', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'dup-meet@x.c', passwordHash: 'x', displayName: 'M' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const s = db
		.insert(segments)
		.values({
			tripId: t.id,
			type: 'meetup',
			title: 'Coffee',
			startAt: '2026-07-01T14:00:00Z',
			startTz: 'UTC',
			endAt: '2026-07-01T15:00:00Z',
			meetingPoint: 'Lobby',
			meetingAt: '2026-07-01T13:30:00Z'
		})
		.returning()
		.get();

	const copy = duplicateSegment(u.id, t.id, s.id);
	expect(copy.meetingPoint).toBe('Lobby');
	expect(copy.meetingAt).toBe('2026-07-02T13:30:00.000Z');
});

test('addSegment stores endTz and defaults to startTz', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'endtz@x.c', passwordHash: 'x', displayName: 'E' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	const withEndTz = addSegment(u.id, t.id, {
		type: 'flight',
		title: 'Outbound',
		localStart: '2026-09-01T08:00:00',
		startTz: 'America/New_York',
		endAt: '2026-09-01T16:00:00',
		endTz: 'Asia/Tokyo'
	});
	expect(withEndTz.startTz).toBe('America/New_York');
	expect(withEndTz.endTz).toBe('Asia/Tokyo');
	expect(withEndTz.startAt).toBe('2026-09-01T12:00:00.000Z');
	expect(withEndTz.endAt).toBe('2026-09-01T07:00:00.000Z');

	const withoutEndTz = addSegment(u.id, t.id, {
		type: 'train',
		title: 'Local',
		localStart: '2026-09-01T10:00:00',
		startTz: 'America/New_York',
		endAt: '2026-09-01T11:00:00'
	});
	expect(withoutEndTz.endTz).toBe('America/New_York');
	expect(withoutEndTz.endAt).toBe('2026-09-01T15:00:00.000Z');
});

test('hasOverlappingSegment uses UTC endAt for comparison', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'overlap-tz@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	db.insert(segments)
		.values({
			tripId: t.id,
			type: 'flight',
			title: 'A',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC',
			endAt: '2026-01-01T12:00:00Z',
			endTz: 'UTC'
		})
		.run();

	expect(hasOverlappingSegment(t.id, undefined, '2026-01-01T11:00:00Z', '2026-01-01T13:00:00Z')).toBe(true);
	expect(hasOverlappingSegment(t.id, undefined, '2026-01-01T12:00:00Z', '2026-01-01T13:00:00Z')).toBe(false);
});

test('updateSegmentStatus updates segment status', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'status@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const s = db
		.insert(segments)
		.values({
			tripId: t.id,
			type: 'flight',
			title: 'F',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC'
		})
		.returning()
		.get();

	const updated = updateSegmentStatus(s.id, 'checked_in');
	expect(updated.status).toBe('checked_in');
	const row = db.select().from(segments).where(eq(segments.id, s.id)).get();
	expect(row?.status).toBe('checked_in');
});

test('updateSegmentStatus rejects invalid status', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'status-bad@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const s = db
		.insert(segments)
		.values({
			tripId: t.id,
			type: 'flight',
			title: 'F',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC'
		})
		.returning()
		.get();

	expect(() => updateSegmentStatus(s.id, 'invalid' as any)).toThrow();
});

test('setSegmentStatus updates status for an editor and logs audit', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'status-editor@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const s = db
		.insert(segments)
		.values({
			tripId: t.id,
			type: 'flight',
			title: 'F',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC'
		})
		.returning()
		.get();

	const updated = setSegmentStatus(u.id, t.id, s.id, 'boarded');
	expect(updated.status).toBe('boarded');
	const logs = db.select().from(auditLogs).where(eq(auditLogs.entityId, s.id)).all();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('update_status');
});

test('setSegmentStatus rejects a non-editor', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const owner = db.insert(users).values({ email: 'status-owner@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const other = db.insert(users).values({ email: 'status-other@x.c', passwordHash: 'x', displayName: 'X' }).returning().get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();
	const s = db
		.insert(segments)
		.values({
			tripId: t.id,
			type: 'flight',
			title: 'F',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC'
		})
		.returning()
		.get();

	expect(() => setSegmentStatus(other.id, t.id, s.id, 'completed')).toThrow();
});

test('addSegment defaults payment status and stores payment details', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'pay@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	const defaulted = addSegment(u.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'UTC'
	});
	expect(defaulted.paymentStatus).toBe('quoted');

	const paid = addSegment(u.id, t.id, {
		type: 'hotel',
		title: 'Hilton',
		localStart: '2026-07-01T15:00:00',
		startTz: 'UTC',
		paymentStatus: 'deposit_paid',
		paymentDueDate: '2026-06-15'
	});
	expect(paid.paymentStatus).toBe('deposit_paid');
	expect(paid.paymentDueDate).toBe('2026-06-15');
});

test('updateSegment changes payment status and due date', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'pay-up@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const s = addSegment(u.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'UTC'
	});

	updateSegment(u.id, t.id, s.id, {
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'UTC',
		paymentStatus: 'fully_paid',
		paymentDueDate: '2026-06-20'
	});

	const row = db.select().from(segments).where(eq(segments.id, s.id)).get()!;
	expect(row.paymentStatus).toBe('fully_paid');
	expect(row.paymentDueDate).toBe('2026-06-20');
});

test('updateSegment preserves existing payment status when omitted', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'pay-pres@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const s = addSegment(u.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'UTC',
		paymentStatus: 'fully_paid'
	});

	updateSegment(u.id, t.id, s.id, {
		title: 'UA1 renamed',
		localStart: '2026-07-01T15:00:00',
		startTz: 'UTC'
	});

	const row = db.select().from(segments).where(eq(segments.id, s.id)).get()!;
	expect(row.paymentStatus).toBe('fully_paid');
	expect(row.title).toBe('UA1 renamed');
});
