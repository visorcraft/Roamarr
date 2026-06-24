import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { users, trips } from '$lib/server/db/schema';
import { resetRateLimit } from '$lib/server/rateLimit';

function event(tripId: number, token: string, ip: string) {
	return {
		params: { id: String(tripId) },
		url: new URL(`http://localhost/trips/${tripId}/calendar/feed?token=${token}`),
		getClientAddress: () => ip
	} as any;
}

test('GET returns an ICS calendar for a valid trip and token', () => {
	resetRateLimit();
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'feed@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db
		.insert(trips)
		.values({ ownerId: u.id, name: 'F', calendarToken: 'cal-tok-1' })
		.returning()
		.get();

	const res = GET(event(t.id, 'cal-tok-1', '1.2.3.4')) as Response;
	expect(res.status).toBe(200);
	expect(res.headers.get('Content-Type')).toContain('text/calendar');
});

test('GET is rate limited after many requests from the same IP', () => {
	resetRateLimit();
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'feed-rl@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db
		.insert(trips)
		.values({ ownerId: u.id, name: 'F', calendarToken: 'cal-tok-2' })
		.returning()
		.get();

	for (let i = 0; i < 30; i++) {
		GET(event(t.id, 'cal-tok-2', '1.2.3.4'));
	}
	const res = GET(event(t.id, 'cal-tok-2', '1.2.3.4')) as Response;
	expect(res.status).toBe(429);
	expect(res.headers.get('Retry-After')).toBeTruthy();
});

test('rate limit does not block a different IP', () => {
	resetRateLimit();
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'feed-rl2@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db
		.insert(trips)
		.values({ ownerId: u.id, name: 'F', calendarToken: 'cal-tok-3' })
		.returning()
		.get();

	for (let i = 0; i < 30; i++) {
		GET(event(t.id, 'cal-tok-3', '1.2.3.4'));
	}
	const res = GET(event(t.id, 'cal-tok-3', '5.6.7.8')) as Response;
	expect(res.status).toBe(200);
});

test('expired calendar token returns 404', () => {
	resetRateLimit();
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'feed-exp@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db
		.insert(trips)
		.values({
			ownerId: u.id,
			name: 'F',
			calendarToken: 'cal-expired',
			calendarTokenExpiresAt: '2020-01-01T00:00:00Z'
		})
		.returning()
		.get();

	try {
		GET(event(t.id, 'cal-expired', '1.2.3.4'));
		expect.fail('expected 404');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});
