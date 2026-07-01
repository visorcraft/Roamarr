import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { kit } from './db';

import { makeUser, makeTrip, makeSegment, makeCard } from '../../../tests/helpers';


import { addSegment, updateSegment, hasOverlappingSegment, duplicateSegment, updateSegmentStatus, setSegmentStatus, deleteSegments, moveSegmentToDate } from './segments';
import { segments, auditLogs } from './db/mongrelSchema';
import { eq } from '@visorcraft/mongreldb-kit';

test('detects overlap with existing segment', () => {
	const u = makeUser(kit, { email: 'o@x.c', passwordHash: 'x', displayName: 'O' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	makeSegment(kit, t.id, {
			type: 'flight',
			title: 'A',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC',
			endAt: '2026-01-01T12:00:00Z'
		});

	expect(hasOverlappingSegment(t.id, undefined, '2026-01-01T11:00:00Z', '2026-01-01T13:00:00Z')).toBe(true);
	expect(hasOverlappingSegment(t.id, undefined, '2026-01-01T13:00:00Z', '2026-01-01T14:00:00Z')).toBe(false);
});

test('excluding current segment avoids self-overlap', () => {
	const u = makeUser(kit, { email: 'o2@x.c', passwordHash: 'x', displayName: 'O2' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
			type: 'flight',
			title: 'A',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC',
			endAt: '2026-01-01T12:00:00Z'
		});

	expect(hasOverlappingSegment(t.id, s.id, '2026-01-01T10:00:00Z', '2026-01-01T12:00:00Z')).toBe(false);
});

test('duplicateSegment copies a segment shifted 24 hours and clears confirmation', () => {
	const u = makeUser(kit, { email: 'dup@x.c', passwordHash: 'x', displayName: 'O' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const c = makeCard(kit, u.id, { nickname: 'Travel', network: 'visa', last4: '1234' });
	const s = makeSegment(kit, t.id, {
			type: 'shuttle',
			title: 'Airport shuttle',
			startAt: '2026-07-01T09:00:00Z',
			startTz: 'America/New_York',
			endAt: '2026-07-01T10:00:00Z',
			endTz: 'America/New_York',
			location: 'JFK',
			confirmationNumber: 'ABC123',
			cardId: c.id,
			detailsJson: JSON.stringify({ note: 'x' })
		});

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

	const rows = kit.selectFrom(segments).where(eq(segments.trip_id, BigInt(t.id))).executeSync();
	expect(rows).toHaveLength(2);

	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.entity_id, BigInt(copy.id))).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('duplicate');
	expect(logs[0].entity_type).toBe('segment');
});

test('duplicateSegment rejects a segment from another trip or non-editor', () => {
	const owner = makeUser(kit, { email: 'dup-owner@x.c', passwordHash: 'x', displayName: 'O' });
	const other = makeUser(kit, { email: 'dup-other@x.c', passwordHash: 'x', displayName: 'X' });
	const t1 = makeTrip(kit, owner.id, { name: 'T1' });
	const t2 = makeTrip(kit, owner.id, { name: 'T2' });
	const s = makeSegment(kit, t1.id, {
			type: 'flight',
			title: 'A',
			startAt: '2026-08-01T08:00:00Z',
			startTz: 'UTC'
		});

	expect(() => duplicateSegment(owner.id, t2.id, s.id)).toThrow();
	expect(() => duplicateSegment(other.id, t1.id, s.id)).toThrow();
});

test('addSegment stores meeting point and rally time as UTC', () => {
	const u = makeUser(kit, { email: 'meet@x.c', passwordHash: 'x', displayName: 'M' });
	const t = makeTrip(kit, u.id, { name: 'T' });

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
	const u = makeUser(kit, { email: 'meet-update@x.c', passwordHash: 'x', displayName: 'M' });
	const t = makeTrip(kit, u.id, { name: 'T' });
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
	const u = makeUser(kit, { email: 'dup-meet@x.c', passwordHash: 'x', displayName: 'M' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
			type: 'meetup',
			title: 'Coffee',
			startAt: '2026-07-01T14:00:00Z',
			startTz: 'UTC',
			endAt: '2026-07-01T15:00:00Z',
			meetingPoint: 'Lobby',
			meetingAt: '2026-07-01T13:30:00Z'
		});

	const copy = duplicateSegment(u.id, t.id, s.id);
	expect(copy.meetingPoint).toBe('Lobby');
	expect(copy.meetingAt).toBe('2026-07-02T13:30:00.000Z');
});

test('moveSegmentToDate preserves local time, duration and rally offset', () => {
	const u = makeUser(kit, { email: 'move-date@x.c', passwordHash: 'x', displayName: 'M' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
			type: 'food',
			title: 'Lunch',
			startAt: '2026-09-16T03:30:00.000Z',
			startTz: 'Asia/Tokyo',
			endAt: '2026-09-16T04:30:00.000Z',
			endTz: 'Asia/Tokyo',
			meetingAt: '2026-09-16T03:15:00.000Z'
		});

	const moved = moveSegmentToDate(u.id, t.id, s.id, '2026-09-15');
	expect(moved.startAt).toBe('2026-09-15T03:30:00.000Z');
	expect(moved.endAt).toBe('2026-09-15T04:30:00.000Z');
	expect(moved.meetingAt).toBe('2026-09-15T03:15:00.000Z');

	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.entity_id, BigInt(s.id))).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('move_date');
});

test('addSegment stores endTz and defaults to startTz', () => {
	const u = makeUser(kit, { email: 'endtz@x.c', passwordHash: 'x', displayName: 'E' });
	const t = makeTrip(kit, u.id, { name: 'T' });

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
	const u = makeUser(kit, { email: 'overlap-tz@x.c', passwordHash: 'x', displayName: 'O' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	makeSegment(kit, t.id, {
			type: 'flight',
			title: 'A',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC',
			endAt: '2026-01-01T12:00:00Z',
			endTz: 'UTC'
		});

	expect(hasOverlappingSegment(t.id, undefined, '2026-01-01T11:00:00Z', '2026-01-01T13:00:00Z')).toBe(true);
	expect(hasOverlappingSegment(t.id, undefined, '2026-01-01T12:00:00Z', '2026-01-01T13:00:00Z')).toBe(false);
});

test('updateSegmentStatus updates segment status', () => {
	const u = makeUser(kit, { email: 'status@x.c', passwordHash: 'x', displayName: 'O' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
			type: 'flight',
			title: 'F',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC'
		});

	const updated = updateSegmentStatus(s.id, 'checked_in');
	expect(updated.status).toBe('checked_in');
	const row = kit.selectFrom(segments).where(eq(segments.id, BigInt(s.id))).executeSync()[0];
	expect(row?.status).toBe('checked_in');
});

test('updateSegmentStatus rejects invalid status', () => {
	const u = makeUser(kit, { email: 'status-bad@x.c', passwordHash: 'x', displayName: 'O' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
			type: 'flight',
			title: 'F',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC'
		});

	expect(() => updateSegmentStatus(s.id, 'invalid' as any)).toThrow();
});

test('setSegmentStatus updates status for an editor and logs audit', () => {
	const u = makeUser(kit, { email: 'status-editor@x.c', passwordHash: 'x', displayName: 'O' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
			type: 'flight',
			title: 'F',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC'
		});

	const updated = setSegmentStatus(u.id, t.id, s.id, 'boarded');
	expect(updated.status).toBe('boarded');
	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.entity_id, BigInt(s.id))).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('update_status');
});

test('setSegmentStatus rejects a non-editor', () => {
	const owner = makeUser(kit, { email: 'status-owner@x.c', passwordHash: 'x', displayName: 'O' });
	const other = makeUser(kit, { email: 'status-other@x.c', passwordHash: 'x', displayName: 'X' });
	const t = makeTrip(kit, owner.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
			type: 'flight',
			title: 'F',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC'
		});

	expect(() => setSegmentStatus(other.id, t.id, s.id, 'completed')).toThrow();
});

test('addSegment defaults payment status and stores payment details', () => {
	const u = makeUser(kit, { email: 'pay@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });

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
	const u = makeUser(kit, { email: 'pay-up@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
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

	const row = kit.selectFrom(segments).where(eq(segments.id, BigInt(s.id))).executeSync()[0]!;
	expect(row.payment_status).toBe('fully_paid');
	expect(row.payment_due_date).toBe('2026-06-20');
});

test('updateSegment preserves existing payment status when omitted', () => {
	const u = makeUser(kit, { email: 'pay-pres@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
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

	const row = kit.selectFrom(segments).where(eq(segments.id, BigInt(s.id))).executeSync()[0]!;
	expect(row.payment_status).toBe('fully_paid');
	expect(row.title).toBe('UA1 renamed');
});

test('deleteSegments removes multiple segments and ignores invalid ids', () => {
	const u = makeUser(kit, { email: 'bulk@x.c', passwordHash: 'x', displayName: 'O' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s1 = makeSegment(kit, t.id, { type: 'flight', title: 'A', startAt: '2026-01-01T10:00:00Z', startTz: 'UTC' });
	const s2 = makeSegment(kit, t.id, { type: 'hotel', title: 'B', startAt: '2026-01-01T14:00:00Z', startTz: 'UTC' });
	const s3 = makeSegment(kit, t.id, { type: 'food', title: 'C', startAt: '2026-01-01T18:00:00Z', startTz: 'UTC' });

	deleteSegments(u.id, t.id, [s1.id, s2.id, 9999, -1]);

	const remaining = kit.selectFrom(segments).where(eq(segments.trip_id, BigInt(t.id))).executeSync();
	expect(remaining.map((r) => Number(r.id))).toEqual([s3.id]);
});

test('addSegment stores country, city, coordinates, and venue', () => {
	const u = makeUser(kit, { email: 'loc@x.c', passwordHash: 'x', displayName: 'L' });
	const t = makeTrip(kit, u.id, { name: 'T' });

	const seg = addSegment(u.id, t.id, {
		type: 'hotel',
		title: 'Grand Hotel',
		localStart: '2026-08-01T15:00:00',
		startTz: 'Europe/Paris',
		countryCode: 'FR',
		cityName: 'Paris',
		cityLat: 48.8534,
		cityLng: 2.3488,
		venue: '1 Rue Example'
	});

	expect(seg.countryCode).toBe('FR');
	expect(seg.cityName).toBe('Paris');
	expect(seg.cityLat).toBe(48.8534);
	expect(seg.cityLng).toBe(2.3488);
	expect(seg.venue).toBe('1 Rue Example');
});

test('updateSegment updates city fields and clears venue when omitted', () => {
	const u = makeUser(kit, { email: 'loc-up@x.c', passwordHash: 'x', displayName: 'L' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const seg = addSegment(u.id, t.id, {
		type: 'food',
		title: 'Lunch',
		localStart: '2026-08-01T12:00:00',
		startTz: 'UTC',
		countryCode: 'FR',
		cityName: 'Paris',
		cityLat: 48.85,
		cityLng: 2.35,
		venue: 'Bistro'
	});

	const updated = updateSegment(u.id, t.id, seg.id, {
		title: 'Lunch',
		localStart: '2026-08-01T12:00:00',
		startTz: 'UTC',
		countryCode: 'JP',
		cityName: 'Tokyo',
		cityLat: 35.68,
		cityLng: 139.76
	});

	expect(updated.countryCode).toBe('JP');
	expect(updated.cityName).toBe('Tokyo');
	expect(updated.venue).toBeNull();
});
