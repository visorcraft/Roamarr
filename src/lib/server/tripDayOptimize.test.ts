import { describe, test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { kit } from '$lib/server/db';

import { makeUser, makeTrip, makeSegment, makeShare } from '../../../tests/helpers';
import { optimizeTripDay, planTripDay, tripDayDirectionsPoints } from './tripDayOptimize';
import { getSegmentById } from './repositories/segmentsRepo';
import { auditLogs } from './db/mongrelSchema';

function auditEntries(tripId: number) {
	return kit.selectFrom(auditLogs).executeSync().filter((r) => r.entity_id === BigInt(tripId));
}

// Untimed = local midnight; timed = any other local wall clock.
const UNTIMED = '2026-07-10T00:00:00Z';
const DAY = '2026-07-10';

describe('optimizeTripDay', () => {
	test('reorders untimed coord-bearing segments and persists day_sort_order', () => {
		const u = makeUser(kit);
		const t = makeTrip(kit, u.id);
		// Crossing order: the optimizer must improve it.
		const nw = makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 1, cityLng: 0 });
		const se = makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 0, cityLng: 1 });
		const ne = makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 1, cityLng: 1 });
		const sw = makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 0, cityLng: 0 });

		const result = optimizeTripDay(u.id, t.id, DAY);
		expect(result.applied).toBe(true);
		expect(result.orderedSegmentIds).toHaveLength(4);
		expect(result.totalDistanceMeters).toBeGreaterThan(0);

		const byId = new Map([nw, se, ne, sw].map((s) => [s.id, s]));
		expect(result.orderedSegmentIds.every((id) => byId.has(id))).toBe(true);
		// Persisted as 1..n in optimized order.
		result.orderedSegmentIds.forEach((id, index) => {
			expect(getSegmentById(id)!.daySortOrder).toBe(index + 1);
		});
	});

	test('timed segments are never reordered or assigned a sort order', () => {
		const u = makeUser(kit);
		const t = makeTrip(kit, u.id);
		const timed = makeSegment(kit, t.id, {
			type: 'food',
			startAt: '2026-07-10T12:30:00Z',
			cityLat: 1,
			cityLng: 1
		});
		const a = makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 0, cityLng: 0 });
		const b = makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 0, cityLng: 1 });

		const result = optimizeTripDay(u.id, t.id, DAY);
		expect(result.applied).toBe(true);
		expect(result.orderedSegmentIds).not.toContain(timed.id);
		expect(new Set(result.orderedSegmentIds)).toEqual(new Set([a.id, b.id]));
		expect(getSegmentById(timed.id)!.daySortOrder).toBeNull();
	});

	test('untimed segments without coordinates are left alone', () => {
		const u = makeUser(kit);
		const t = makeTrip(kit, u.id);
		const noCoords = makeSegment(kit, t.id, { type: 'note', startAt: UNTIMED });
		makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 0, cityLng: 0 });
		makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 0, cityLng: 1 });

		const result = optimizeTripDay(u.id, t.id, DAY);
		expect(result.orderedSegmentIds).not.toContain(noCoords.id);
		expect(getSegmentById(noCoords.id)!.daySortOrder).toBeNull();
	});

	test('hotel on the day anchors the optimized path', () => {
		const u = makeUser(kit);
		const t = makeTrip(kit, u.id);
		makeSegment(kit, t.id, {
			type: 'hotel',
			startAt: '2026-07-10T15:00:00Z',
			cityLat: 0,
			cityLng: 0
		});
		const near = makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 0.1, cityLng: 0 });
		const far = makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 10, cityLng: 10 });
		const mid = makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 5, cityLng: 5 });

		const result = optimizeTripDay(u.id, t.id, DAY);
		expect(result.orderedSegmentIds).toEqual([near.id, mid.id, far.id]);
	});

	test('no-op day writes nothing and skips the audit entry', () => {
		const u = makeUser(kit);
		const t = makeTrip(kit, u.id);
		const only = makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 1, cityLng: 1 });

		const result = optimizeTripDay(u.id, t.id, DAY);
		expect(result.applied).toBe(false);
		expect(result.orderedSegmentIds).toEqual([only.id]);
		expect(getSegmentById(only.id)!.daySortOrder).toBeNull();
		expect(auditEntries(t.id)).toHaveLength(0);
	});

	test('logs a trip_day_optimize audit entry when applied', () => {
		const u = makeUser(kit);
		const t = makeTrip(kit, u.id);
		makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 0, cityLng: 0 });
		makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 0, cityLng: 1 });

		optimizeTripDay(u.id, t.id, DAY);
		const entries = auditEntries(t.id);
		expect(entries).toHaveLength(1);
		expect(entries[0].action).toBe('trip_day_optimize');
		expect(entries[0].entity_type).toBe('trip');
		expect(JSON.parse(String(entries[0].meta_json ?? '{}'))).toMatchObject({ date: DAY, count: 2 });
	});

	test('rejects an invalid date', () => {
		const u = makeUser(kit);
		const t = makeTrip(kit, u.id);
		expect(() => optimizeTripDay(u.id, t.id, 'July 10')).toThrowError(
			expect.objectContaining({ status: 400 })
		);
	});

	test('edit-share user can optimize; read-share user and strangers cannot', () => {
		const owner = makeUser(kit);
		const editor = makeUser(kit);
		const reader = makeUser(kit);
		const stranger = makeUser(kit);
		const t = makeTrip(kit, owner.id);
		makeShare(kit, { tripId: t.id, sharedWithUserId: editor.id, permission: 'edit' });
		makeShare(kit, { tripId: t.id, sharedWithUserId: reader.id, permission: 'read' });
		makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 0, cityLng: 0 });
		makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 0, cityLng: 1 });

		expect(optimizeTripDay(editor.id, t.id, DAY).applied).toBe(true);
		expect(() => optimizeTripDay(reader.id, t.id, DAY)).toThrowError(
			expect.objectContaining({ status: 404 })
		);
		expect(() => optimizeTripDay(stranger.id, t.id, DAY)).toThrowError(
			expect.objectContaining({ status: 404 })
		);
		expect(() => planTripDay(reader.id, t.id, DAY)).toThrowError(
			expect.objectContaining({ status: 404 })
		);
	});

	test('planTripDay previews without writing or auditing', () => {
		const u = makeUser(kit);
		const t = makeTrip(kit, u.id);
		const a = makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 0, cityLng: 0 });
		const b = makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 0, cityLng: 1 });

		const preview = planTripDay(u.id, t.id, DAY);
		expect(preview.applied).toBe(false);
		expect(new Set(preview.orderedSegmentIds)).toEqual(new Set([a.id, b.id]));
		expect(getSegmentById(a.id)!.daySortOrder).toBeNull();
		expect(getSegmentById(b.id)!.daySortOrder).toBeNull();
		expect(auditEntries(t.id)).toHaveLength(0);
	});
});

describe('tripDayDirectionsPoints', () => {
	test('returns coord points in display order (untimed by day_sort_order, then timed)', () => {
		const u = makeUser(kit);
		const t = makeTrip(kit, u.id);
		makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 10, cityLng: 10 });
		makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 0, cityLng: 0 });
		makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 0, cityLng: 10 });
		makeSegment(kit, t.id, { type: 'food', startAt: '2026-07-10T12:00:00Z', cityLat: 5, cityLng: 5 });
		makeSegment(kit, t.id, { type: 'note', startAt: UNTIMED }); // no coords

		optimizeTripDay(u.id, t.id, DAY);
		const points = tripDayDirectionsPoints(u.id, t.id, DAY);
		// Optimizer orders the untimed stops (southernmost seed first), then the
		// timed lunch; the coord-less note is excluded.
		expect(points).toEqual([
			{ lat: 0, lng: 0 },
			{ lat: 0, lng: 10 },
			{ lat: 10, lng: 10 },
			{ lat: 5, lng: 5 }
		]);
	});

	test('read-share viewer can build directions but a stranger cannot', () => {
		const owner = makeUser(kit);
		const reader = makeUser(kit);
		const stranger = makeUser(kit);
		const t = makeTrip(kit, owner.id);
		makeShare(kit, { tripId: t.id, sharedWithUserId: reader.id, permission: 'read' });
		makeSegment(kit, t.id, { type: 'poi', startAt: UNTIMED, cityLat: 1, cityLng: 1 });

		expect(tripDayDirectionsPoints(reader.id, t.id, DAY)).toEqual([{ lat: 1, lng: 1 }]);
		expect(() => tripDayDirectionsPoints(stranger.id, t.id, DAY)).toThrowError(
			expect.objectContaining({ status: 404 })
		);
	});
});
