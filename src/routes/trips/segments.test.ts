import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _addSegment as addSegment } from './[id]/segments/+page.server';
import { users, trips, cards, segments } from '$lib/server/db/schema';

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
