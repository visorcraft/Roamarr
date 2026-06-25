import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { notifications } from './db/schema';
import { requireOwnedUserRow } from './ownership';
import { nowIso } from './tz';

export function listNotifications(userId: number) {
	return db.select().from(notifications).where(eq(notifications.userId, userId)).all();
}

export function markRead(userId: number, id: number) {
	requireOwnedUserRow(notifications, userId, id, 'Notification not found');
	db.update(notifications).set({ readAt: nowIso() }).where(eq(notifications.id, id)).run();
}

export function markUnread(userId: number, id: number) {
	requireOwnedUserRow(notifications, userId, id, 'Notification not found');
	db.update(notifications).set({ readAt: null }).where(eq(notifications.id, id)).run();
}

export function markAllRead(userId: number) {
	db.update(notifications)
		.set({ readAt: nowIso() })
		.where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
		.run();
}
