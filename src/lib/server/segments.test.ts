import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { hasOverlappingSegment } from './segments';
import { users, trips, segments } from './db/schema';

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
