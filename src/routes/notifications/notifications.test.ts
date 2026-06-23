import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _markRead as markRead } from './+page.server';
import { users, notifications } from '$lib/server/db/schema';

test('markRead only affects the caller’s own notification', () => {
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
	const nB = db
		.insert(notifications)
		.values({ userId: b.id, title: 't', body: 'b' })
		.returning()
		.get();
	markRead(a.id, nB.id);
	expect(db.select().from(notifications).get()!.readAt).toBeNull();
	markRead(b.id, nB.id);
	expect(db.select().from(notifications).get()!.readAt).not.toBeNull();
});
