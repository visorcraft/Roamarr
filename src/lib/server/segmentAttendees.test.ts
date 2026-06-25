import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { eq } from 'drizzle-orm';
import {
	listAttendeesForSegment,
	listAttendeesForSegments,
	upsertAttendee,
	deleteAttendee
} from './segmentAttendees';
import { users, trips, segments, tripCompanions, auditLogs } from './db/schema';

function expectHttpError(fn: () => void, status: number) {
	try {
		fn();
		throw new Error('Expected HTTP error');
	} catch (e: unknown) {
		const err = e as { status?: number; body?: { message?: string } };
		expect(err.status).toBe(status);
		expect(err.body?.message).toBeDefined();
	}
}

test('sets and updates attendee status for a segment', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'o@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const s = db
		.insert(segments)
		.values({ tripId: t.id, type: 'flight', title: 'A', startAt: '2026-01-01T10:00:00Z', startTz: 'UTC' })
		.returning()
		.get();
	const c = db.insert(tripCompanions).values({ tripId: t.id, name: 'A', category: 'adult' }).returning().get();

	upsertAttendee(u.id, t.id, s.id, c.id, 'going');
	let rows = listAttendeesForSegment(s.id);
	expect(rows).toHaveLength(1);
	expect(rows[0].status).toBe('going');

	upsertAttendee(u.id, t.id, s.id, c.id, 'maybe');
	rows = listAttendeesForSegment(s.id);
	expect(rows).toHaveLength(1);
	expect(rows[0].status).toBe('maybe');

	const audit = db.select().from(auditLogs).where(eq(auditLogs.entityId, s.id)).all();
	expect(audit.length).toBeGreaterThanOrEqual(2);
	expect(audit[audit.length - 1].action).toBe('set_attendee_status');
});

test('deletes an attendee', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'o2@x.c', passwordHash: 'x', displayName: 'O2' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T2' }).returning().get();
	const s = db
		.insert(segments)
		.values({ tripId: t.id, type: 'flight', title: 'B', startAt: '2026-01-02T10:00:00Z', startTz: 'UTC' })
		.returning()
		.get();
	const c = db.insert(tripCompanions).values({ tripId: t.id, name: 'B' }).returning().get();

	upsertAttendee(u.id, t.id, s.id, c.id, 'going');
	expect(listAttendeesForSegment(s.id)).toHaveLength(1);

	deleteAttendee(u.id, t.id, s.id, c.id);
	expect(listAttendeesForSegment(s.id)).toHaveLength(0);

	const audit = db.select().from(auditLogs).where(eq(auditLogs.entityId, s.id)).all();
	expect(audit.some((a) => a.action === 'remove_attendee')).toBe(true);
});

test('loads attendees grouped by segment', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'o3@x.c', passwordHash: 'x', displayName: 'O3' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T3' }).returning().get();
	const s1 = db
		.insert(segments)
		.values({ tripId: t.id, type: 'hotel', title: 'H1', startAt: '2026-01-03T10:00:00Z', startTz: 'UTC' })
		.returning()
		.get();
	const s2 = db
		.insert(segments)
		.values({ tripId: t.id, type: 'hotel', title: 'H2', startAt: '2026-01-04T10:00:00Z', startTz: 'UTC' })
		.returning()
		.get();
	const c1 = db.insert(tripCompanions).values({ tripId: t.id, name: 'C1' }).returning().get();
	const c2 = db.insert(tripCompanions).values({ tripId: t.id, name: 'C2' }).returning().get();

	upsertAttendee(u.id, t.id, s1.id, c1.id, 'going');
	upsertAttendee(u.id, t.id, s2.id, c2.id, 'not_going');

	const map = listAttendeesForSegments([s1.id, s2.id]);
	expect(map.get(s1.id)).toHaveLength(1);
	expect(map.get(s1.id)![0].status).toBe('going');
	expect(map.get(s2.id)).toHaveLength(1);
	expect(map.get(s2.id)![0].status).toBe('not_going');
});

test('rejects invalid status', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'o4@x.c', passwordHash: 'x', displayName: 'O4' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T4' }).returning().get();
	const s = db
		.insert(segments)
		.values({ tripId: t.id, type: 'flight', title: 'D', startAt: '2026-01-05T10:00:00Z', startTz: 'UTC' })
		.returning()
		.get();
	const c = db.insert(tripCompanions).values({ tripId: t.id, name: 'D' }).returning().get();

	expectHttpError(
		() => upsertAttendee(u.id, t.id, s.id, c.id, 'invalid' as 'going'),
		400
	);
});

test('enforces trip ownership via segment and companion', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const a = db.insert(users).values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const tA = db.insert(trips).values({ ownerId: a.id, name: 'TA' }).returning().get();
	const tB = db.insert(trips).values({ ownerId: b.id, name: 'TB' }).returning().get();
	const sA = db
		.insert(segments)
		.values({ tripId: tA.id, type: 'flight', title: 'SA', startAt: '2026-01-06T10:00:00Z', startTz: 'UTC' })
		.returning()
		.get();
	const cB = db.insert(tripCompanions).values({ tripId: tB.id, name: 'CB' }).returning().get();

	expectHttpError(() => upsertAttendee(b.id, tA.id, sA.id, cB.id, 'going'), 404);
	expectHttpError(() => upsertAttendee(a.id, tA.id, sA.id, cB.id, 'going'), 404);
	expectHttpError(() => deleteAttendee(b.id, tA.id, sA.id, cB.id), 404);
});

test('empty segment id list returns empty map', () => {
	const map = listAttendeesForSegments([]);
	expect(map.size).toBe(0);
});

test('deleting non-existing attendee is idempotent', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'o5@x.c', passwordHash: 'x', displayName: 'O5' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T5' }).returning().get();
	const s = db
		.insert(segments)
		.values({ tripId: t.id, type: 'flight', title: 'E', startAt: '2026-01-07T10:00:00Z', startTz: 'UTC' })
		.returning()
		.get();
	const c = db.insert(tripCompanions).values({ tripId: t.id, name: 'E' }).returning().get();

	expect(() => deleteAttendee(u.id, t.id, s.id, c.id)).not.toThrow();
});
