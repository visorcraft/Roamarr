import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { eq, type KitDatabase } from '@visorcraft/mongreldb-kit';
import * as repo from './remindersRepo';
import * as usersRepo from './usersRepo';
import {
	reminders,
	notifications,
	schedulerRuns
} from '$lib/server/db/mongrelSchema';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function makeUser(email: string) {
	return usersRepo.createUser({
		email,
		password_hash: 'x',
		display_name: email,
		calendar_token: null,
		calendar_token_expires_at: null
	});
}

beforeEach(() => {
	const kit = kitDb();
	kit.deleteFrom(schedulerRuns).executeSync();
	kit.deleteFrom(notifications).executeSync();
	kit.deleteFrom(reminders).executeSync();
});

// Reminders

test('create/get/list/update/delete reminder', () => {
	const kit = kitDb();
	const u = makeUser('reminder@x.c');

	const created = repo.createReminder({
		userId: Number(u.id),
		kind: 'custom',
		refType: 'trip',
		refId: 1,
		fireAt: '2026-01-01T00:00:00Z'
	});
	expect(created.userId).toBe(Number(u.id));
	expect(created.status).toBe('pending');

	expect(repo.getReminderById(created.id)?.fireAt).toBe('2026-01-01T00:00:00Z');
	expect(repo.getReminderBySource('custom', 'trip', 1)?.id).toBe(created.id);
	expect(repo.listRemindersForUser(Number(u.id))).toHaveLength(1);

	const stored = kit
		.selectFrom(reminders)
		.where(eq(reminders.id, BigInt(created.id)))
		.executeSync()[0];
	expect(stored?.fire_at).toBe('2026-01-01T00:00:00Z');

	const updated = repo.updateReminder(created.id, { fireAt: '2026-01-02T00:00:00Z' });
	expect(updated?.fireAt).toBe('2026-01-02T00:00:00Z');
	expect(
		kit.selectFrom(reminders).where(eq(reminders.id, BigInt(created.id))).executeSync()[0]?.fire_at
	).toBe('2026-01-02T00:00:00Z');

	expect(repo.deleteReminder(created.id)).toBe(true);
	expect(repo.getReminderById(created.id)).toBeNull();
	expect(repo.listRemindersForUser(Number(u.id))).toHaveLength(0);
	expect(kit.selectFrom(reminders).where(eq(reminders.id, BigInt(created.id))).executeSync()[0]).toBeUndefined();
});

test('upsertReminderBySource updates existing row', () => {
	const u = makeUser('upsert@x.c');
	const first = repo.createReminder({
		userId: Number(u.id),
		kind: 'flight_checkin',
		refType: 'segment',
		refId: 5,
		fireAt: '2026-01-01T00:00:00Z'
	});
	const second = repo.upsertReminderBySource({
		userId: Number(u.id),
		kind: 'flight_checkin',
		refType: 'segment',
		refId: 5,
		fireAt: '2026-01-03T00:00:00Z'
	});
	expect(second.id).toBe(first.id);
	expect(repo.listRemindersForUser(Number(u.id))).toHaveLength(1);
});

test('listPendingRemindersBefore filters by status and fireAt', () => {
	const u = makeUser('pending@x.c');
	const now = '2026-01-02T00:00:00Z';
	repo.createReminder({
		userId: Number(u.id),
		kind: 'custom',
		refType: 'trip',
		refId: 1,
		fireAt: '2026-01-01T00:00:00Z'
	});
	repo.createReminder({
		userId: Number(u.id),
		kind: 'custom',
		refType: 'trip',
		refId: 2,
		fireAt: '2026-01-03T00:00:00Z'
	});
	repo.createReminder({
		userId: Number(u.id),
		kind: 'custom',
		refType: 'trip',
		refId: 3,
		fireAt: '2026-01-01T00:00:00Z',
		status: 'sent'
	});

	const pending = repo.listPendingRemindersBefore(now);
	expect(pending).toHaveLength(1);
	expect(pending[0].refId).toBe(1);
});

test('markReminderSent updates status', () => {
	const kit = kitDb();
	const u = makeUser('sent@x.c');
	const r = repo.createReminder({
		userId: Number(u.id),
		kind: 'custom',
		refType: 'trip',
		refId: 1,
		fireAt: '2026-01-01T00:00:00Z'
	});
	const updated = repo.markReminderSent(r.id, '2026-01-01T01:00:00Z');
	expect(updated?.status).toBe('sent');
	expect(updated?.sentAt).toBe('2026-01-01T01:00:00Z');
	expect(
		kit.selectFrom(reminders).where(eq(reminders.id, BigInt(r.id))).executeSync()[0]?.status
	).toBe('sent');
});

test('deleteRemindersForRef removes rows by ref', () => {
	const u = makeUser('ref@x.c');
	repo.createReminder({
		userId: Number(u.id),
		kind: 'custom',
		refType: 'trip',
		refId: 10,
		fireAt: '2026-01-01T00:00:00Z'
	});
	repo.deleteRemindersForRef('trip', 10);
	expect(repo.getReminderBySource('custom', 'trip', 10)).toBeNull();
});

// Notifications

test('create/list/count/get/mark-read/delete notification', () => {
	const kit = kitDb();
	const u = makeUser('notif@x.c');

	const created = repo.createNotification({
		userId: Number(u.id),
		title: 'Hello',
		body: 'World',
		link: '/trips'
	});
	expect(created.title).toBe('Hello');

	expect(repo.listNotificationsForUser(Number(u.id))).toHaveLength(1);
	expect(repo.countUnreadNotificationsForUser(Number(u.id))).toBe(1);
	expect(repo.getNotificationById(created.id)?.body).toBe('World');

	const stored = kit
		.selectFrom(notifications)
		.where(eq(notifications.id, BigInt(created.id)))
		.executeSync()[0];
	expect(stored?.title).toBe('Hello');

	const read = repo.markNotificationRead(created.id, '2026-01-01T00:00:00Z');
	expect(read?.readAt).toBe('2026-01-01T00:00:00Z');
	expect(repo.countUnreadNotificationsForUser(Number(u.id))).toBe(0);
	expect(
		kit.selectFrom(notifications).where(eq(notifications.id, BigInt(created.id))).executeSync()[0]
			?.read_at
	).not.toBeNull();

	repo.markNotificationUnread(created.id);
	expect(repo.countUnreadNotificationsForUser(Number(u.id))).toBe(1);

	expect(repo.deleteNotification(created.id)).toBe(true);
	expect(repo.getNotificationById(created.id)).toBeNull();
});

test('listNotificationsForUser respects includeRead and limit', () => {
	const u = makeUser('notif-opts@x.c');
	const a = repo.createNotification({ userId: Number(u.id), title: 'A', body: 'a' });
	repo.createNotification({ userId: Number(u.id), title: 'B', body: 'b' });
	repo.markNotificationRead(a.id);

	expect(repo.listNotificationsForUser(Number(u.id), { includeRead: false })).toHaveLength(1);
	expect(repo.listNotificationsForUser(Number(u.id), { limit: 1 })).toHaveLength(1);
});

// Scheduler runs

test('start/finish/list/prune scheduler runs', () => {
	const kit = kitDb();
	const run = repo.startSchedulerRun('tick');
	expect(run.finishedAt).toBeNull();

	const finished = repo.finishSchedulerRun(run.id, { success: true });
	expect(finished?.success).toBe(true);
	expect(finished?.finishedAt).not.toBeNull();

	const stored = kit
		.selectFrom(schedulerRuns)
		.where(eq(schedulerRuns.id, BigInt(run.id)))
		.executeSync()[0];
	expect(stored?.success).toBe(true);

	expect(repo.listRecentSchedulerRuns(10)).toHaveLength(1);

	repo.pruneOldSchedulerRuns('2099-01-01T00:00:00Z');
	expect(repo.listRecentSchedulerRuns(10)).toHaveLength(0);
});

test('countSchedulerRuns with and without search', () => {
	const ok = repo.startSchedulerRun('tick');
	repo.finishSchedulerRun(ok.id, { success: true });
	const failed = repo.startSchedulerRun('tick');
	repo.finishSchedulerRun(failed.id, { success: false, errorMessage: 'boom' });

	expect(repo.countSchedulerRuns()).toBe(2);
	expect(repo.countSchedulerRuns('success')).toBe(1);
	expect(repo.countSchedulerRuns('failure')).toBe(1);
	expect(repo.countSchedulerRuns('boom')).toBe(1);
	expect(repo.countSchedulerRuns('no-match')).toBe(0);
});

test('listSchedulerRuns respects limit and offset', () => {
	const a = repo.startSchedulerRun('tick');
	repo.finishSchedulerRun(a.id, { success: true });
	const b = repo.startSchedulerRun('tick');
	repo.finishSchedulerRun(b.id, { success: true });
	const c = repo.startSchedulerRun('tick');
	repo.finishSchedulerRun(c.id, { success: true });

	const all = repo.listSchedulerRuns({ limit: 10, offset: 0 });
	expect(all).toHaveLength(3);

	expect(repo.listSchedulerRuns({ limit: 1, offset: 0 })).toHaveLength(1);
	expect(repo.listSchedulerRuns({ limit: 1, offset: 0 })[0].id).toBe(c.id);
	expect(repo.listSchedulerRuns({ limit: 1, offset: 1 })[0].id).toBe(b.id);
	expect(repo.listSchedulerRuns({ limit: 1, offset: 2 })[0].id).toBe(a.id);
	expect(repo.listSchedulerRuns({ limit: 10, offset: 5 })).toHaveLength(0);
});

test('listSchedulerRuns filters by search', () => {
	const ok = repo.startSchedulerRun('tick');
	repo.finishSchedulerRun(ok.id, { success: true });
	const failed = repo.startSchedulerRun('tick');
	repo.finishSchedulerRun(failed.id, { success: false, errorMessage: 'connection timeout' });

	expect(repo.listSchedulerRuns({ search: 'success' })).toHaveLength(1);
	expect(repo.listSchedulerRuns({ search: 'failure' })[0].id).toBe(failed.id);
	expect(repo.listSchedulerRuns({ search: 'timeout' })).toHaveLength(1);
	expect(repo.listSchedulerRuns({ search: 'timeout' })[0].id).toBe(failed.id);
	expect(repo.listSchedulerRuns({ search: 'no-match' })).toHaveLength(0);
});

test('listSchedulerRuns sorts by startedAt ascending and descending', () => {
	const a = repo.startSchedulerRun('tick');
	repo.updateSchedulerRun(a.id, { startedAt: '2024-01-01T00:00:00Z' });
	const b = repo.startSchedulerRun('tick');
	repo.updateSchedulerRun(b.id, { startedAt: '2024-01-02T00:00:00Z' });

	const desc = repo.listSchedulerRuns({ sortBy: 'startedAt', sortDir: 'desc' });
	expect(desc[0].id).toBe(b.id);
	expect(desc[1].id).toBe(a.id);

	const asc = repo.listSchedulerRuns({ sortBy: 'startedAt', sortDir: 'asc' });
	expect(asc[0].id).toBe(a.id);
	expect(asc[1].id).toBe(b.id);
});
