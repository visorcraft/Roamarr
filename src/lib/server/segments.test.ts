import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { kit } from './db';

import { makeUser, makeTrip, makeSegment, makeCard } from '../../../tests/helpers';


import { addSegment, updateSegment, hasOverlappingSegment, duplicateSegment, updateSegmentStatus, setSegmentStatus, deleteSegments, moveSegmentToDate, patchSegment } from './segments';
import { segments, auditLogs } from './db/mongrelSchema';
import { eq } from '@visorcraft/mongreldb-kit';
import * as tripsRepo from './repositories/tripsRepo';
import { getSegmentById } from './repositories/segmentsRepo';

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

test('duplicateSegment copies a segment on the same day and clears confirmation', () => {
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
	expect(copy.startAt).toBe('2026-07-01T09:00:00Z');
	expect(copy.endAt).toBe('2026-07-01T10:00:00Z');
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

test('duplicateSegment lets a shared editor copy an owner-card segment and drops the card', () => {
	const owner = makeUser(kit, { email: 'dup-card-owner@x.c', passwordHash: 'x', displayName: 'O' });
	const editor = makeUser(kit, { email: 'dup-card-editor@x.c', passwordHash: 'x', displayName: 'E' });
	const t = makeTrip(kit, owner.id, { name: 'T' });
	const ownerCard = makeCard(kit, owner.id, { nickname: 'Owner', network: 'visa', last4: '1111' });
	const s = makeSegment(kit, t.id, {
		type: 'flight',
		title: 'A',
		startAt: '2026-09-01T08:00:00Z',
		startTz: 'UTC',
		cardId: ownerCard.id
	});
	tripsRepo.createShare({ tripId: t.id, sharedWithUserId: editor.id, permission: 'edit', showDetails: false });

	const copy = duplicateSegment(editor.id, t.id, s.id);
	expect(copy.id).not.toBe(s.id);
	expect(copy.cardId).toBeNull();
	expect(getSegmentById(s.id)?.cardId).toBe(ownerCard.id);
});

test('duplicateSegment lets the owner copy an editor-card segment and drops the card', () => {
	const owner = makeUser(kit, { email: 'dup-ecard-owner@x.c', passwordHash: 'x', displayName: 'O' });
	const editor = makeUser(kit, { email: 'dup-ecard-editor@x.c', passwordHash: 'x', displayName: 'E' });
	const t = makeTrip(kit, owner.id, { name: 'T' });
	const editorCard = makeCard(kit, editor.id, { nickname: 'Editor', network: 'visa', last4: '2222' });
	const s = makeSegment(kit, t.id, {
		type: 'flight',
		title: 'A',
		startAt: '2026-09-02T08:00:00Z',
		startTz: 'UTC',
		cardId: editorCard.id
	});
	tripsRepo.createShare({ tripId: t.id, sharedWithUserId: editor.id, permission: 'edit', showDetails: false });

	const copy = duplicateSegment(owner.id, t.id, s.id);
	expect(copy.cardId).toBeNull();
	expect(getSegmentById(s.id)?.cardId).toBe(editorCard.id);
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

test('duplicateSegment copies meeting point and rally time on the same day', () => {
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
	expect(copy.meetingAt).toBe('2026-07-01T13:30:00Z');
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

test('moveSegmentToDate rejects non-date-only targets and writes nothing', () => {
	const u = makeUser(kit, { email: 'move-reject@x.c', passwordHash: 'x', displayName: 'M' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
		type: 'flight',
		title: 'A',
		startAt: '2026-09-10T13:00:00.000Z',
		startTz: 'America/New_York',
		endAt: '2026-09-10T17:00:00.000Z'
	});

	const original = getSegmentById(s.id)!;

	for (const bad of [
		'2026-09-15T00:00:00Z',
		'2026-09-15T09:00:00+02:00',
		'2026-09',
		'2026',
		'20260915',
		'2026-02-30'
	]) {
		try {
			moveSegmentToDate(u.id, t.id, s.id, bad);
			expect.unreachable(`expected a 400 for ${bad}`);
		} catch (e: any) {
			expect(e.status).toBe(400);
		}
		const after = getSegmentById(s.id)!;
		expect(after.startAt).toBe(original.startAt);
		expect(after.endAt).toBe(original.endAt);
		expect(after.meetingAt).toBe(original.meetingAt);
		const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.entity_id, BigInt(s.id))).executeSync();
		expect(logs).toHaveLength(0);
	}
});

test('moveSegmentToDate fails closed on an unparseable stored end_at', () => {
	const u = makeUser(kit, { email: 'move-end-bad@x.c', passwordHash: 'x', displayName: 'M' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
		type: 'flight',
		title: 'A',
		startAt: '2026-09-10T13:00:00.000Z',
		startTz: 'America/New_York',
		endAt: '2026-09-10T17:00:00.000Z'
	});

	kit.updateTable(segments).set({ end_at: 'not-a-date' }).where(eq(segments.id, BigInt(s.id))).executeSync();

	try {
		moveSegmentToDate(u.id, t.id, s.id, '2026-09-15');
		expect.unreachable('expected a 400 for an unparseable end_at');
	} catch (e: any) {
		expect(e.status).toBe(400);
	}

	const after = getSegmentById(s.id)!;
	expect(after.startAt).toBe('2026-09-10T13:00:00.000Z');
	expect(after.endAt).toBe('not-a-date');
	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.entity_id, BigInt(s.id))).executeSync();
	expect(logs).toHaveLength(0);
});

test('moveSegmentToDate fails closed on an unparseable stored meeting_at', () => {
	const u = makeUser(kit, { email: 'move-meeting-bad@x.c', passwordHash: 'x', displayName: 'M' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
		type: 'meetup',
		title: 'A',
		startAt: '2026-09-10T13:00:00.000Z',
		startTz: 'America/New_York',
		endAt: '2026-09-10T17:00:00.000Z',
		meetingAt: '2026-09-10T16:00:00.000Z'
	});

	kit.updateTable(segments).set({ meeting_at: 'not-a-date' }).where(eq(segments.id, BigInt(s.id))).executeSync();

	try {
		moveSegmentToDate(u.id, t.id, s.id, '2026-09-15');
		expect.unreachable('expected a 400 for an unparseable meeting_at');
	} catch (e: any) {
		expect(e.status).toBe(400);
	}

	const after = getSegmentById(s.id)!;
	expect(after.startAt).toBe('2026-09-10T13:00:00.000Z');
	expect(after.endAt).toBe('2026-09-10T17:00:00.000Z');
	expect(after.meetingAt).toBe('not-a-date');
	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.entity_id, BigInt(s.id))).executeSync();
	expect(logs).toHaveLength(0);
});

test('moveSegmentToDate keeps wall-clock time across a DST boundary', () => {
	const u = makeUser(kit, { email: 'move-dst@x.c', passwordHash: 'x', displayName: 'M' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
		type: 'flight',
		title: 'A',
		startAt: '2026-03-07T19:00:00.000Z',
		startTz: 'America/New_York',
		endAt: '2026-03-07T23:00:00.000Z',
		meetingAt: '2026-03-07T17:00:00.000Z'
	});

	const moved = moveSegmentToDate(u.id, t.id, s.id, '2026-09-15');
	expect(moved.startAt).toBe('2026-09-15T18:00:00.000Z');
	expect(moved.endAt).toBe('2026-09-15T22:00:00.000Z');
	expect(moved.meetingAt).toBe('2026-09-15T16:00:00.000Z');

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
		localStart: '2026-09-01T02:00:00',
		startTz: 'America/New_York',
		endAt: '2026-09-01T16:00:00',
		endTz: 'Asia/Tokyo'
	});
	expect(withEndTz.startTz).toBe('America/New_York');
	expect(withEndTz.endTz).toBe('Asia/Tokyo');
	expect(withEndTz.startAt).toBe('2026-09-01T06:00:00.000Z');
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

test('patchSegment updates type and payment status', () => {
	const u = makeUser(kit, { email: 'mcp-pay@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = makeSegment(kit, t.id, { type: 'hotel', title: 'Hotel', startAt: '2026-01-01T14:00:00Z', startTz: 'UTC' });
	expect(patchSegment(u.id, s.id, { type: 'shuttle', paymentStatus: 'fully_paid' })).toMatchObject({ type: 'shuttle', paymentStatus: 'fully_paid' });
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

test('addSegment rejects an end before the start and writes no row', () => {
	const u = makeUser(kit, { email: 'end-before@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });

	try {
		addSegment(u.id, t.id, {
			type: 'flight',
			title: 'Backwards',
			localStart: '2026-09-01T15:00:00',
			startTz: 'UTC',
			endAt: '2026-09-01T14:00:00'
		});
		expect.unreachable('expected end-before-start error');
	} catch (e: any) {
		expect(e.status).toBe(400);
	}
	const rows = kit.selectFrom(segments).where(eq(segments.trip_id, BigInt(t.id))).executeSync();
	expect(rows).toHaveLength(0);
});

test('addSegment accepts a zero-duration end and a cross-zone end that is earlier on the clock', () => {
	const u = makeUser(kit, { email: 'zero-dur@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });

	const zero = addSegment(u.id, t.id, {
		type: 'flight',
		title: 'Zero duration',
		localStart: '2026-09-01T10:00:00',
		startTz: 'UTC',
		endAt: '2026-09-01T10:00:00'
	});
	expect(zero.endAt).toBe('2026-09-01T10:00:00.000Z');
	expect(zero.endAt).toBe(zero.startAt);

	const cross = addSegment(u.id, t.id, {
		type: 'flight',
		title: 'Cross zone',
		localStart: '2026-12-01T23:30',
		startTz: 'America/New_York',
		endAt: '2026-12-01T22:30',
		endTz: 'America/Los_Angeles'
	});
	expect(cross.startAt).toBe('2026-12-02T04:30:00.000Z');
	expect(cross.endAt).toBe('2026-12-02T06:30:00.000Z');
});

test('updateSegment rejects an end before the start and leaves the row unchanged', () => {
	const u = makeUser(kit, { email: 'update-end@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = addSegment(u.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-09-01T10:00:00',
		startTz: 'UTC',
		endAt: '2026-09-01T12:00:00'
	});

	try {
		updateSegment(u.id, t.id, s.id, {
			title: 'UA1',
			localStart: '2026-09-01T10:00:00',
			startTz: 'UTC',
			endAt: '2026-09-01T09:00:00'
		});
		expect.unreachable('expected end-before-start error');
	} catch (e: any) {
		expect(e.status).toBe(400);
	}
	const row = kit.selectFrom(segments).where(eq(segments.id, BigInt(s.id))).executeSync()[0]!;
	expect(row.end_at).toBe('2026-09-01T12:00:00.000Z');
	expect(row.title).toBe('UA1');
});

test('patchSegment rejects an endAt earlier than the stored start', () => {
	const u = makeUser(kit, { email: 'patch-end@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
		type: 'flight',
		title: 'A',
		startAt: '2026-01-01T10:00:00Z',
		startTz: 'UTC',
		endAt: '2026-01-01T12:00:00Z'
	});

	try {
		patchSegment(u.id, s.id, { endAt: '2026-01-01T09:00:00Z' });
		expect.unreachable('expected end-before-start error');
	} catch (e: any) {
		expect(e.status).toBe(400);
	}
	const row = kit.selectFrom(segments).where(eq(segments.id, BigInt(s.id))).executeSync()[0]!;
	expect(row.end_at).toBe('2026-01-01T12:00:00Z');
});

test('patchSegment rejects a startAt later than the stored end', () => {
	const u = makeUser(kit, { email: 'patch-start@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
		type: 'flight',
		title: 'A',
		startAt: '2026-01-01T10:00:00Z',
		startTz: 'UTC',
		endAt: '2026-01-01T12:00:00Z'
	});

	try {
		patchSegment(u.id, s.id, { startAt: '2026-01-01T13:00:00Z' });
		expect.unreachable('expected start-after-end error');
	} catch (e: any) {
		expect(e.status).toBe(400);
	}
	const row = kit.selectFrom(segments).where(eq(segments.id, BigInt(s.id))).executeSync()[0]!;
	expect(row.start_at).toBe('2026-01-01T10:00:00Z');
	expect(row.end_at).toBe('2026-01-01T12:00:00Z');
});

test('patchSegment still renames a legacy inverted segment', () => {
	const u = makeUser(kit, { email: 'patch-rename@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
		type: 'flight',
		title: 'Old',
		startAt: '2026-01-01T12:00:00Z',
		startTz: 'UTC',
		endAt: '2026-01-01T10:00:00Z'
	});

	const updated = patchSegment(u.id, s.id, { title: 'New' });
	expect(updated.title).toBe('New');
	expect(updated.startAt).toBe('2026-01-01T12:00:00Z');
	expect(updated.endAt).toBe('2026-01-01T10:00:00Z');
});

test('shared editor without details keeps the owner card and stored confirmation/details', () => {
	const owner = makeUser(kit, { email: 'card-owner1@x.c', passwordHash: 'x', displayName: 'O' });
	const editor = makeUser(kit, { email: 'card-editor1@x.c', passwordHash: 'x', displayName: 'E' });
	const t = makeTrip(kit, owner.id, { name: 'T' });
	const ownerCard = makeCard(kit, owner.id, { nickname: 'Owner', network: 'visa', last4: '1111' });
	const s = makeSegment(kit, t.id, {
		type: 'flight',
		title: 'Flight',
		startAt: '2026-01-01T10:00:00Z',
		startTz: 'UTC',
		confirmationNumber: 'CONF123',
		detailsJson: JSON.stringify({ note: 'keep' }),
		cardId: ownerCard.id
	});
	tripsRepo.createShare({ tripId: t.id, sharedWithUserId: editor.id, permission: 'edit', showDetails: false });

	const updated = updateSegment(editor.id, t.id, s.id, {
		title: 'Flight renamed',
		localStart: '2026-01-01T10:00:00',
		startTz: 'UTC'
	});

	expect(updated.cardId).toBe(ownerCard.id);
	expect(updated.confirmationNumber).toBe('CONF123');
	expect(updated.detailsJson).toBe(JSON.stringify({ note: 'keep' }));
	const row = kit.selectFrom(segments).where(eq(segments.id, BigInt(s.id))).executeSync()[0]!;
	expect(Number(row.card_id)).toBe(ownerCard.id);
	expect(row.confirmation_number).toBe('CONF123');
	expect(row.details_json).toBe(JSON.stringify({ note: 'keep' }));
});

test('shared editor with details keeps the owner card', () => {
	const owner = makeUser(kit, { email: 'card-owner2@x.c', passwordHash: 'x', displayName: 'O' });
	const editor = makeUser(kit, { email: 'card-editor2@x.c', passwordHash: 'x', displayName: 'E' });
	const t = makeTrip(kit, owner.id, { name: 'T' });
	const ownerCard = makeCard(kit, owner.id, { nickname: 'Owner', network: 'visa', last4: '1111' });
	const s = makeSegment(kit, t.id, {
		type: 'flight',
		title: 'Flight',
		startAt: '2026-01-01T10:00:00Z',
		startTz: 'UTC',
		cardId: ownerCard.id
	});
	tripsRepo.createShare({ tripId: t.id, sharedWithUserId: editor.id, permission: 'edit', showDetails: true });

	const updated = updateSegment(editor.id, t.id, s.id, {
		title: 'Flight renamed',
		localStart: '2026-01-01T10:00:00',
		startTz: 'UTC'
	});

	expect(updated.cardId).toBe(ownerCard.id);
	const row = kit.selectFrom(segments).where(eq(segments.id, BigInt(s.id))).executeSync()[0]!;
	expect(Number(row.card_id)).toBe(ownerCard.id);
});

test('owner can clear and replace the card', () => {
	const u = makeUser(kit, { email: 'card-owner3@x.c', passwordHash: 'x', displayName: 'O' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const c1 = makeCard(kit, u.id, { nickname: 'C1', network: 'visa', last4: '1111' });
	const c2 = makeCard(kit, u.id, { nickname: 'C2', network: 'amex', last4: '2222' });
	const s = makeSegment(kit, t.id, {
		type: 'flight',
		title: 'Flight',
		startAt: '2026-01-01T10:00:00Z',
		startTz: 'UTC',
		cardId: c1.id
	});

	const replaced = updateSegment(u.id, t.id, s.id, {
		title: 'Flight',
		localStart: '2026-01-01T10:00:00',
		startTz: 'UTC',
		cardId: c2.id
	});
	expect(replaced.cardId).toBe(c2.id);
	const row = kit.selectFrom(segments).where(eq(segments.id, BigInt(s.id))).executeSync()[0]!;
	expect(Number(row.card_id)).toBe(c2.id);

	const cleared = updateSegment(u.id, t.id, s.id, {
		title: 'Flight',
		localStart: '2026-01-01T10:00:00',
		startTz: 'UTC'
	});
	expect(cleared.cardId).toBeNull();
	const row2 = kit.selectFrom(segments).where(eq(segments.id, BigInt(s.id))).executeSync()[0]!;
	expect(row2.card_id).toBeNull();
});

test('shared editor can set their own card', () => {
	const owner = makeUser(kit, { email: 'card-owner4@x.c', passwordHash: 'x', displayName: 'O' });
	const editor = makeUser(kit, { email: 'card-editor4@x.c', passwordHash: 'x', displayName: 'E' });
	const t = makeTrip(kit, owner.id, { name: 'T' });
	const ownerCard = makeCard(kit, owner.id, { nickname: 'Owner', network: 'visa', last4: '1111' });
	const editorCard = makeCard(kit, editor.id, { nickname: 'Mine', network: 'amex', last4: '3333' });
	const s = makeSegment(kit, t.id, {
		type: 'flight',
		title: 'Flight',
		startAt: '2026-01-01T10:00:00Z',
		startTz: 'UTC',
		cardId: ownerCard.id
	});
	tripsRepo.createShare({ tripId: t.id, sharedWithUserId: editor.id, permission: 'edit', showDetails: false });

	const updated = updateSegment(editor.id, t.id, s.id, {
		title: 'Flight',
		localStart: '2026-01-01T10:00:00',
		startTz: 'UTC',
		cardId: editorCard.id
	});

	expect(updated.cardId).toBe(editorCard.id);
	const row = kit.selectFrom(segments).where(eq(segments.id, BigInt(s.id))).executeSync()[0]!;
	expect(Number(row.card_id)).toBe(editorCard.id);
});

test('shared editor cannot set the owner card and read-only viewer and stranger are rejected', () => {
	const owner = makeUser(kit, { email: 'card-owner5@x.c', passwordHash: 'x', displayName: 'O' });
	const editor = makeUser(kit, { email: 'card-editor5@x.c', passwordHash: 'x', displayName: 'E' });
	const viewer = makeUser(kit, { email: 'card-viewer5@x.c', passwordHash: 'x', displayName: 'V' });
	const stranger = makeUser(kit, { email: 'card-stranger5@x.c', passwordHash: 'x', displayName: 'S' });
	const t = makeTrip(kit, owner.id, { name: 'T' });
	const ownerCard = makeCard(kit, owner.id, { nickname: 'Owner', network: 'visa', last4: '1111' });
	const s = makeSegment(kit, t.id, {
		type: 'flight',
		title: 'Flight',
		startAt: '2026-01-01T10:00:00Z',
		startTz: 'UTC',
		cardId: ownerCard.id
	});
	tripsRepo.createShare({ tripId: t.id, sharedWithUserId: editor.id, permission: 'edit', showDetails: false });
	tripsRepo.createShare({ tripId: t.id, sharedWithUserId: viewer.id, permission: 'read', showDetails: false });

	expect(() =>
		updateSegment(editor.id, t.id, s.id, {
			title: 'Flight',
			localStart: '2026-01-01T10:00:00',
			startTz: 'UTC',
			cardId: ownerCard.id
		})
	).toThrow();
	const row = kit.selectFrom(segments).where(eq(segments.id, BigInt(s.id))).executeSync()[0]!;
	expect(Number(row.card_id)).toBe(ownerCard.id);

	expect(() =>
		updateSegment(viewer.id, t.id, s.id, {
			title: 'Flight',
			localStart: '2026-01-01T10:00:00',
			startTz: 'UTC'
		})
	).toThrow();
	expect(() =>
		updateSegment(stranger.id, t.id, s.id, {
			title: 'Flight',
			localStart: '2026-01-01T10:00:00',
			startTz: 'UTC'
		})
	).toThrow();
	const row2 = kit.selectFrom(segments).where(eq(segments.id, BigInt(s.id))).executeSync()[0]!;
	expect(Number(row2.card_id)).toBe(ownerCard.id);
});
