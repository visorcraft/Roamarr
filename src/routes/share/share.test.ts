import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _loadByToken as loadByToken, load } from './[token]/+page.server';
import { users, trips, segments } from '$lib/server/db/schema';
import { resetRateLimit } from '$lib/server/rateLimit';

test('valid token returns projection without sensitive data; bad token 404s', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const t = db
		.insert(trips)
		.values({ ownerId: a.id, name: 'T', notes: 'SECRET', publicToken: 'tok123' })
		.returning()
		.get();
	db.insert(segments)
		.values({
			tripId: t.id,
			type: 'flight',
			title: 'UA1',
			startAt: '2026-07-01T00:00:00Z',
			startTz: 'UTC',
			confirmationNumber: 'CONF'
		})
		.run();
	const data = loadByToken('tok123') as { trip: { segments: unknown[] } };
	expect(JSON.stringify(data)).not.toContain('SECRET');
	expect(JSON.stringify(data)).not.toContain('CONF');
	expect(() => loadByToken('nope')).toThrow();
});

test('load is rate limited after many requests from the same IP', () => {
	resetRateLimit();
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'rl@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	db.insert(trips).values({ ownerId: a.id, name: 'T', publicToken: 'rltok' }).run();

	for (let i = 0; i < 20; i++) {
		load({ params: { token: 'rltok' }, getClientAddress: () => '1.2.3.4' } as any);
	}
	try {
		load({ params: { token: 'rltok' }, getClientAddress: () => '1.2.3.4' } as any);
		expect.fail('expected 429');
	} catch (e: any) {
		expect(e.status).toBe(429);
		expect(e.body?.message).toBe('Too many requests');
	}
});

test('rate limit does not block a different IP', () => {
	resetRateLimit();
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'rl2@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	db.insert(trips).values({ ownerId: a.id, name: 'T', publicToken: 'rltok2' }).run();

	for (let i = 0; i < 20; i++) {
		load({ params: { token: 'rltok2' }, getClientAddress: () => '1.2.3.4' } as any);
	}
	const data = load({ params: { token: 'rltok2' }, getClientAddress: () => '5.6.7.8' } as any) as {
		trip: { name: string };
	};
	expect(data.trip.name).toBe('T');
});
