import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load } from './+page.server';
import { users, trips, segments, tripCompanions } from '$lib/server/db/schema';

function event(user: { id: number }, tripId: number) {
	return {
		locals: { user } as App.Locals,
		params: { id: String(tripId) }
	} as any;
}

test('load returns trip, day-grouped segments, and companions', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'print@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db
		.insert(trips)
		.values({ ownerId: u.id, name: 'Japan trip', destination: 'Tokyo', startDate: '2026-04-01', endDate: '2026-04-03' })
		.returning()
		.get();
	db.insert(segments).values({
		tripId: t.id,
		type: 'flight',
		title: 'Outbound flight',
		startAt: '2026-04-01T09:00:00Z',
		startTz: 'UTC',
		location: 'NRT',
		confirmationNumber: 'ABC123'
	}).run();
	db.insert(segments).values({
		tripId: t.id,
		type: 'hotel',
		title: 'Hotel check-in',
		startAt: '2026-04-01T15:00:00Z',
		startTz: 'UTC',
		location: 'Shinjuku'
	}).run();
	db.insert(tripCompanions).values({ tripId: t.id, name: 'Ada', category: 'adult', notes: 'Friend' }).run();
	db.insert(tripCompanions).values({ tripId: t.id, name: 'Leo', category: 'child' }).run();

	const result = load(event(u, t.id)) as {
		trip: { name: string };
		segments: { title: string }[];
		companions: { name: string }[];
		owner: boolean;
		editor: boolean;
	};

	expect(result.trip.name).toBe('Japan trip');
	expect(result.segments).toHaveLength(2);
	expect(result.companions).toHaveLength(2);
	expect(result.companions.map((c) => c.name)).toEqual(['Ada', 'Leo']);
	expect(result.owner).toBe(true);
	expect(result.editor).toBe(true);
});

test('load rejects a trip the user cannot view', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db.insert(users).values({ email: 'owner@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const other = db.insert(users).values({ email: 'other@x.c', passwordHash: 'x', displayName: 'X' }).returning().get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'Private' }).returning().get();

	expect(() => load(event(other, t.id))).toThrow();
});
