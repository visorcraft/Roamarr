import { error } from '@sveltejs/kit';
import {
	listNotificationsForUser,
	countUnreadNotificationsForUser,
	getNotificationById,
	markNotificationRead,
	markNotificationUnread
} from './repositories/remindersRepo';
import { nowIso } from './tz';

export function listNotifications(userId: number) {
	return listNotificationsForUser(userId);
}

export function unreadCount(userId: number): number {
	return countUnreadNotificationsForUser(userId);
}

function requireOwnedNotification(userId: number, id: number) {
	const n = getNotificationById(id);
	if (!n || n.userId !== userId) throw error(404, 'Notification not found');
	return n;
}

export function markRead(userId: number, id: number) {
	requireOwnedNotification(userId, id);
	markNotificationRead(id, nowIso());
}

export function markUnread(userId: number, id: number) {
	requireOwnedNotification(userId, id);
	markNotificationUnread(id);
}

export function markAllRead(userId: number) {
	for (const n of listNotificationsForUser(userId, { includeRead: false })) {
		markNotificationRead(n.id, nowIso());
	}
}
