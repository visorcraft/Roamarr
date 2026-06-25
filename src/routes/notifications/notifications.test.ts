import { test, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { actions } from './+page.server';
import {
	markRead,
	markUnread,
	markAllRead
} from '$lib/server/notifications';
import { users, notifications } from '$lib/server/db/schema';

function makeUser(email: string, name: string) {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	return db
		.insert(users)
		.values({ email, passwordHash: 'x', displayName: name })
		.returning()
		.get();
}

function insertNotification(userId: number, title: string) {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	return db.insert(notifications).values({ userId, title, body: 'b' }).returning().get();
}

test('markRead only affects the caller’s own notification', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeUser('a1@x.c', 'A');
	const b = makeUser('b1@x.c', 'B');
	const nB = insertNotification(b.id, 't');
	expect(() => markRead(a.id, nB.id)).toThrow(
		expect.objectContaining({ status: 404, body: { message: 'Notification not found' } })
	);
	expect(db.select().from(notifications).get()!.readAt).toBeNull();
	markRead(b.id, nB.id);
	expect(db.select().from(notifications).get()!.readAt).not.toBeNull();
});

test('markUnread clears readAt for the caller’s own notification', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeUser('a2@x.c', 'A');
	const b = makeUser('b2@x.c', 'B');
	const nB = insertNotification(b.id, 't');
	markRead(b.id, nB.id);
	expect(() => markUnread(a.id, nB.id)).toThrow(
		expect.objectContaining({ status: 404, body: { message: 'Notification not found' } })
	);
	markUnread(b.id, nB.id);
	expect(db.select().from(notifications).where(eq(notifications.id, nB.id)).get()!.readAt).toBeNull();
});

test('markAllRead only affects the caller’s unread notifications', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeUser('a3@x.c', 'A');
	const b = makeUser('b3@x.c', 'B');
	const nA1 = insertNotification(a.id, 'a1');
	const nA2 = insertNotification(a.id, 'a2');
	const nB = insertNotification(b.id, 'b1');
	markRead(a.id, nA1.id);
	markAllRead(a.id);
	const rows = db.select().from(notifications).all();
	expect(rows.find((r) => r.id === nA1.id)!.readAt).not.toBeNull();
	expect(rows.find((r) => r.id === nA2.id)!.readAt).not.toBeNull();
	expect(rows.find((r) => r.id === nB.id)!.readAt).toBeNull();
});

test('markAllRead action sets a flash cookie and redirects', async () => {
	const a = makeUser('a-action@x.c', 'A');
	insertNotification(a.id, 'n1');
	const cookies = { set: vi.fn(), get: vi.fn() };
	const locals = { user: a } as App.Locals;
	await expect(actions.markAllRead({ locals, cookies } as any)).rejects.toMatchObject({
		status: 303,
		location: '/notifications'
	});
	expect(cookies.set).toHaveBeenCalledWith('flash', 'All notifications marked read.', expect.any(Object));
});
