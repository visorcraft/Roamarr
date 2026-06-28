import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import { users, reminders } from '$lib/server/db/mongrelSchema';
import { eq } from '@mongreldb/kit';

test('load returns the users reminders', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const other = db.insert(users).values({ email: 'b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	db.insert(reminders).values({
		userId: u.id,
		kind: 'custom',
		refType: 'trip',
		refId: 1,
		fireAt: '2026-01-01T00:00:00Z'
	}).run();
	db.insert(reminders).values({
		userId: other.id,
		kind: 'custom',
		refType: 'trip',
		refId: 2,
		fireAt: '2026-01-02T00:00:00Z'
	}).run();

	const data = (await load({ locals: { user: u } } as any)) as { reminders: { userId: number }[] };
	expect(data.reminders).toHaveLength(1);
	expect(data.reminders[0].userId).toBe(u.id);
});

test('cancel action deletes the users own reminder', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'c@x.c', passwordHash: 'x', displayName: 'C' }).returning().get();
	const r = db.insert(reminders).values({
		userId: u.id,
		kind: 'custom',
		refType: 'trip',
		refId: 3,
		fireAt: '2026-01-01T00:00:00Z'
	}).returning().get();

	await expect(
		actions.cancel({
			request: new Request('http://x', { method: 'POST', body: new URLSearchParams({ id: String(r.id) }) }),
			locals: { user: u }
		} as any)
	).rejects.toSatisfy((e: any) => e.status === 303 && e.location === '/profile/reminders');

	expect(db.select().from(reminders).where(eq(reminders.id, BigInt(r.id))).get()).toBeUndefined();
});
