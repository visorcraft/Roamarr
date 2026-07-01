import { test, expect, vi } from 'vitest';
import { eq } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

function kitDb(): import('@visorcraft/mongreldb-kit').KitDatabase {
	return (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
}

import { actions } from './+page.server';
import {
	markRead,
	markUnread,
	markAllRead
} from '$lib/server/notifications';
import { notifications } from '$lib/server/db/mongrelSchema';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { createNotification } from '$lib/server/repositories/remindersRepo';

function makeUser(email: string, name: string) {
	const u = usersRepo.createUser({
		email,
		password_hash: 'x',
		display_name: name,
		calendar_token: null,
		calendar_token_expires_at: null
	});
	return { ...u, id: Number(u.id) };
}

function insertNotification(userId: number, title: string) {
	const n = createNotification({ userId, title, body: 'b' });
	return { ...n, id: n.id };
}

test('markRead only affects the caller’s own notification', () => {
	const kit = kitDb();
	const a = makeUser('a1@x.c', 'A');
	const b = makeUser('b1@x.c', 'B');
	const nB = insertNotification(b.id, 't');
	expect(() => markRead(a.id, nB.id)).toThrow(
		expect.objectContaining({ status: 404, body: { message: 'Notification not found' } })
	);
	// Kit returns '' for an unset nullable timestamp, not null.
	expect(kit.selectFrom(notifications).executeSync()[0]!.read_at).toBeFalsy();
	markRead(b.id, nB.id);
	expect(kit.selectFrom(notifications).executeSync()[0]!.read_at).toBeTruthy();
});

test('markUnread clears readAt for the caller’s own notification', () => {
	const kit = kitDb();
	const a = makeUser('a2@x.c', 'A');
	const b = makeUser('b2@x.c', 'B');
	const nB = insertNotification(b.id, 't');
	markRead(b.id, nB.id);
	expect(() => markUnread(a.id, nB.id)).toThrow(
		expect.objectContaining({ status: 404, body: { message: 'Notification not found' } })
	);
	markUnread(b.id, nB.id);
	expect(
		kit.selectFrom(notifications).where(eq(notifications.id, BigInt(nB.id))).executeSync()[0]!.read_at
	).toBeFalsy();
});

test('markAllRead only affects the caller’s unread notifications', () => {
	const kit = kitDb();
	const a = makeUser('a3@x.c', 'A');
	const b = makeUser('b3@x.c', 'B');
	const nA1 = insertNotification(a.id, 'a1');
	const nA2 = insertNotification(a.id, 'a2');
	const nB = insertNotification(b.id, 'b1');
	markRead(a.id, nA1.id);
	markAllRead(a.id);
	const rows = kit.selectFrom(notifications).executeSync();
	expect(rows.find((r) => Number(r.id) === nA1.id)!.read_at).toBeTruthy();
	expect(rows.find((r) => Number(r.id) === nA2.id)!.read_at).toBeTruthy();
	expect(rows.find((r) => Number(r.id) === nB.id)!.read_at).toBeFalsy();
});

test('markAllRead action sets a flash cookie and redirects', async () => {
	const a = makeUser('a-action@x.c', 'A');
	insertNotification(a.id, 'n1');
	const cookies = { set: vi.fn(), get: vi.fn() };
	const locals = { user: a } as unknown as App.Locals;
	await expect(actions.markAllRead({ locals, cookies } as any)).rejects.toMatchObject({
		status: 303,
		location: '/notifications'
	});
	expect(cookies.set).toHaveBeenCalledWith('flash', 'All notifications marked read.', expect.any(Object));
});
