import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { loadByToken } from './[token]/+page.server';
import { users, trips, segments } from '$lib/server/db/schema';

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
