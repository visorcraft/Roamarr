import { test, expect, vi, beforeEach, afterAll } from 'vitest';

const ctx = vi.hoisted(() => ({
	db: null as unknown as import('$lib/server/db').DB,
	sqlite: null as unknown as import('better-sqlite3').Database,
	kit: null as unknown as import('@mongreldb/kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	const { db, sqlite, kit, close } = freshDb();
	Object.assign(ctx, { db, sqlite, kit, close });
	return { db, sqlite, kit, getDb: () => kit };
});

import { eq } from 'drizzle-orm';
import { eq as kitEq } from '@mongreldb/kit';
import {
	listSegmentsForTrip,
	getSegmentById,
	createSegment,
	updateSegment,
	deleteSegment,
	deleteSegmentsForTrip,
	countOverlappingSegments,
	listAttendeesForSegment,
	addAttendee,
	removeAttendee,
	getAttendeeBySegmentAndCompanion,
	upsertAttendee
} from './segmentsRepo';
import { createTrip } from './tripsRepo';
import { makeKitUser } from '../../../../tests/kitHelpers';
import { segments, segmentAttendees, tripCompanions } from '$lib/server/db/mongrelSchema';
import {
	segments as drizzleSegments,
	segmentAttendees as drizzleSegmentAttendees,
	tripCompanions as drizzleTripCompanions
} from '$lib/server/db/schema';

function resetKitTables() {
	ctx.kit.deleteFrom(segmentAttendees).executeSync();
	ctx.kit.deleteFrom(segments).executeSync();
	ctx.kit.deleteFrom(tripCompanions).executeSync();
}

function resetLegacyTables() {
	ctx.sqlite.exec(
		'delete from segment_attendees; delete from segments; delete from trip_companions; delete from trips; delete from users;'
	);
}

beforeEach(() => {
	resetKitTables();
	resetLegacyTables();
});

afterAll(() => {
	ctx.close();
});

function makeKitTrip(ownerId: number, name = 'T') {
	return createTrip(ownerId, { name });
}

function makeKitCompanion(tripId: number, name = 'C') {
	const row = ctx.kit
		.insertInto(tripCompanions)
		.values({
			trip_id: BigInt(tripId),
			name
		} as any)
		.executeSync();
	ctx.db
		.insert(drizzleTripCompanions)
		.values({
			id: Number(row.id),
			tripId,
			name,
			category: 'adult'
		})
		.run();
	return row;
}

test('creates and retrieves a segment', () => {
	const u = makeKitUser();
	const t = makeKitTrip(Number(u.id));
	const seg = createSegment({
		trip_id: BigInt(t.id),
		type: 'flight',
		title: 'UA1',
		start_at: '2026-07-01T19:00:00Z',
		start_tz: 'America/New_York'
	});
	expect(seg.id).toBeTypeOf('number');
	expect(seg.tripId).toBe(t.id);

	const found = getSegmentById(seg.id);
	expect(found?.title).toBe('UA1');
	expect(found?.startTz).toBe('America/New_York');

	const listed = listSegmentsForTrip(t.id);
	expect(listed).toHaveLength(1);
	expect(listed[0]!.title).toBe('UA1');
});

test('updates a segment', () => {
	const u = makeKitUser();
	const t = makeKitTrip(Number(u.id));
	const seg = createSegment({
		trip_id: BigInt(t.id),
		type: 'hotel',
		title: 'H1',
		start_at: '2026-07-01T15:00:00Z',
		start_tz: 'UTC'
	});
	const updated = updateSegment(seg.id, { title: 'H1 Updated', payment_status: 'fully_paid' });
	expect(updated?.title).toBe('H1 Updated');
	expect(updated?.paymentStatus).toBe('fully_paid');
	expect(getSegmentById(seg.id)?.title).toBe('H1 Updated');
});

test('deletes a segment and cascades attendees', () => {
	const u = makeKitUser();
	const t = makeKitTrip(Number(u.id));
	const seg = createSegment({
		trip_id: BigInt(t.id),
		type: 'food',
		title: 'Lunch',
		start_at: '2026-07-01T12:00:00Z',
		start_tz: 'UTC'
	});
	const c = makeKitCompanion(t.id);
	addAttendee({ segment_id: BigInt(seg.id), companion_id: BigInt(c.id), status: 'going' });

	deleteSegment(seg.id);
	expect(getSegmentById(seg.id)).toBeNull();
	expect(listAttendeesForSegment(seg.id)).toHaveLength(0);
});

test('deletes multiple segments for a trip', () => {
	const u = makeKitUser();
	const t = makeKitTrip(Number(u.id));
	const s1 = createSegment({
		trip_id: BigInt(t.id),
		type: 'flight',
		title: 'A',
		start_at: '2026-07-01T10:00:00Z',
		start_tz: 'UTC'
	});
	const s2 = createSegment({
		trip_id: BigInt(t.id),
		type: 'hotel',
		title: 'B',
		start_at: '2026-07-01T14:00:00Z',
		start_tz: 'UTC'
	});
	deleteSegmentsForTrip(t.id, [s1.id, s2.id]);
	expect(listSegmentsForTrip(t.id)).toHaveLength(0);
});

test('counts overlapping segments', () => {
	const u = makeKitUser();
	const t = makeKitTrip(Number(u.id));
	createSegment({
		trip_id: BigInt(t.id),
		type: 'flight',
		title: 'A',
		start_at: '2026-01-01T10:00:00Z',
		start_tz: 'UTC',
		end_at: '2026-01-01T12:00:00Z',
		end_tz: 'UTC'
	});
	expect(countOverlappingSegments(t.id, '2026-01-01T11:00:00Z', '2026-01-01T13:00:00Z')).toBe(1n);
	expect(countOverlappingSegments(t.id, '2026-01-01T12:00:00Z', '2026-01-01T13:00:00Z')).toBe(0n);
});

test('manages attendees', () => {
	const u = makeKitUser();
	const t = makeKitTrip(Number(u.id));
	const seg = createSegment({
		trip_id: BigInt(t.id),
		type: 'flight',
		title: 'F',
		start_at: '2026-01-01T10:00:00Z',
		start_tz: 'UTC'
	});
	const c = makeKitCompanion(t.id);

	const attendee = addAttendee({ segment_id: BigInt(seg.id), companion_id: BigInt(c.id), status: 'going' });
	expect(attendee.segmentId).toBe(seg.id);
	expect(attendee.companionId).toBe(Number(c.id));

	let attendees = listAttendeesForSegment(seg.id);
	expect(attendees).toHaveLength(1);
	expect(attendees[0]!.name).toBe('C');
	expect(attendees[0]!.status).toBe('going');

	upsertAttendee(seg.id, Number(c.id), 'maybe');
	attendees = listAttendeesForSegment(seg.id);
	expect(attendees[0]!.status).toBe('maybe');

	removeAttendee(attendee.id);
	expect(listAttendeesForSegment(seg.id)).toHaveLength(0);
	expect(getAttendeeBySegmentAndCompanion(seg.id, Number(c.id))).toBeNull();
});

test('keeps Drizzle segments in sync', () => {
	const u = makeKitUser();
	const t = makeKitTrip(Number(u.id));
	const seg = createSegment({
		trip_id: BigInt(t.id),
		type: 'train',
		title: 'T',
		start_at: '2026-08-01T10:00:00Z',
		start_tz: 'UTC'
	});
	const row = ctx.db.select().from(drizzleSegments).where(eq(drizzleSegments.id, seg.id)).get();
	expect(row?.title).toBe('T');

	updateSegment(seg.id, { title: 'T Updated' });
	expect(ctx.db.select().from(drizzleSegments).where(eq(drizzleSegments.id, seg.id)).get()?.title).toBe(
		'T Updated'
	);

	deleteSegment(seg.id);
	expect(ctx.db.select().from(drizzleSegments).where(eq(drizzleSegments.id, seg.id)).get()).toBeUndefined();
});

test('keeps Drizzle attendees in sync', () => {
	const u = makeKitUser();
	const t = makeKitTrip(Number(u.id));
	const seg = createSegment({
		trip_id: BigInt(t.id),
		type: 'flight',
		title: 'F',
		start_at: '2026-08-01T10:00:00Z',
		start_tz: 'UTC'
	});
	const c = makeKitCompanion(t.id);
	const a = addAttendee({ segment_id: BigInt(seg.id), companion_id: BigInt(c.id), status: 'going' });
	const row = ctx.db
		.select()
		.from(drizzleSegmentAttendees)
		.where(eq(drizzleSegmentAttendees.id, a.id))
		.get();
	expect(row?.status).toBe('going');

	removeAttendee(a.id);
	expect(
		ctx.db.select().from(drizzleSegmentAttendees).where(eq(drizzleSegmentAttendees.id, a.id)).get()
	).toBeUndefined();
});

test('listSegmentsForTrip excludes deleted segments', () => {
	const u = makeKitUser();
	const t = makeKitTrip(Number(u.id));
	const s1 = createSegment({
		trip_id: BigInt(t.id),
		type: 'flight',
		title: 'A',
		start_at: '2026-07-01T10:00:00Z',
		start_tz: 'UTC'
	});
	createSegment({
		trip_id: BigInt(t.id),
		type: 'hotel',
		title: 'B',
		start_at: '2026-07-02T10:00:00Z',
		start_tz: 'UTC'
	});
	deleteSegment(s1.id);
	const listed = listSegmentsForTrip(t.id);
	expect(listed).toHaveLength(1);
	expect(listed[0]!.title).toBe('B');
});
