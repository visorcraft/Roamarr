import {
	eq as kitEq,
	and as kitAnd,
	inList as kitInList,
	asc as kitAsc,
	desc as kitDesc,
	lte as kitLte,
	lt as kitLt,
	isNull as kitIsNull,
	isNotNull as kitIsNotNull
} from '@mongreldb/kit';
import {
	eq as drizzleEq,
	and as drizzleAnd,
	inArray as drizzleInArray,
	lte as drizzleLte,
	lt as drizzleLt,
	isNull as drizzleIsNull,
	not as drizzleNot,
	sql,
	count as drizzleCount
} from 'drizzle-orm';
import { db, kit } from '$lib/server/db';
import {
	reminders as kitReminders,
	notifications as kitNotifications,
	schedulerRuns as kitSchedulerRuns
} from '$lib/server/db/mongrelSchema';
import {
	reminders as drizzleReminders,
	notifications as drizzleNotifications,
	schedulerRuns as drizzleSchedulerRuns
} from '$lib/server/db/schema';
import type { Row, Insert, Update } from '@mongreldb/kit';
import { nowIso } from '$lib/server/tz';

export type ReminderRow = typeof drizzleReminders.$inferSelect;
export type NotificationRow = typeof drizzleNotifications.$inferSelect;
export type SchedulerRunRow = typeof drizzleSchedulerRuns.$inferSelect;

type KitReminder = Row<typeof kitReminders>;
type KitNotification = Row<typeof kitNotifications>;
type KitSchedulerRun = Row<typeof kitSchedulerRuns>;

function num(id: bigint): number {
	return Number(id);
}

function toBigInt(id: number): bigint {
	return BigInt(id);
}

function toReminderRow(row: KitReminder): ReminderRow {
	return {
		id: num(row.id),
		userId: num(row.user_id),
		kind: row.kind as ReminderRow['kind'],
		refType: row.ref_type as ReminderRow['refType'],
		refId: num(row.ref_id),
		fireAt: row.fire_at,
		status: row.status as ReminderRow['status'],
		attempts: Number(row.attempts),
		sentAt: row.sent_at,
		createdAt: row.created_at
	};
}

function toNotificationRow(row: KitNotification): NotificationRow {
	return {
		id: num(row.id),
		userId: num(row.user_id),
		title: row.title,
		body: row.body,
		link: row.link,
		createdAt: row.created_at,
		readAt: row.read_at
	};
}

function toSchedulerRunRow(row: KitSchedulerRun): SchedulerRunRow {
	return {
		id: num(row.id),
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		success: row.success,
		errorMessage: row.error_message
	};
}

function kitReminderToDrizzleInsert(row: KitReminder): typeof drizzleReminders.$inferInsert {
	return {
		id: num(row.id),
		userId: num(row.user_id),
		kind: row.kind,
		refType: row.ref_type,
		refId: num(row.ref_id),
		fireAt: row.fire_at,
		status: row.status,
		attempts: Number(row.attempts),
		sentAt: row.sent_at,
		createdAt: row.created_at
	};
}

function kitNotificationToDrizzleInsert(row: KitNotification): typeof drizzleNotifications.$inferInsert {
	return {
		id: num(row.id),
		userId: num(row.user_id),
		title: row.title,
		body: row.body,
		link: row.link,
		createdAt: row.created_at,
		readAt: row.read_at
	};
}

function kitSchedulerRunToDrizzleInsert(row: KitSchedulerRun): typeof drizzleSchedulerRuns.$inferInsert {
	return {
		id: num(row.id),
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		success: row.success,
		errorMessage: row.error_message
	};
}

function syncReminderToLegacy(row: KitReminder) {
	const values = kitReminderToDrizzleInsert(row);
	const id = values.id!;
	const existing = db.select().from(drizzleReminders).where(drizzleEq(drizzleReminders.id, id)).get();
	if (existing) {
		db.update(drizzleReminders).set(values).where(drizzleEq(drizzleReminders.id, id)).run();
	} else {
		db.insert(drizzleReminders).values(values).run();
	}
}

function syncNotificationToLegacy(row: KitNotification) {
	const values = kitNotificationToDrizzleInsert(row);
	const id = values.id!;
	const existing = db
		.select()
		.from(drizzleNotifications)
		.where(drizzleEq(drizzleNotifications.id, id))
		.get();
	if (existing) {
		db.update(drizzleNotifications)
			.set(values)
			.where(drizzleEq(drizzleNotifications.id, id))
			.run();
	} else {
		db.insert(drizzleNotifications).values(values).run();
	}
}

function syncSchedulerRunToLegacy(row: KitSchedulerRun) {
	const values = kitSchedulerRunToDrizzleInsert(row);
	const id = values.id!;
	const existing = db
		.select()
		.from(drizzleSchedulerRuns)
		.where(drizzleEq(drizzleSchedulerRuns.id, id))
		.get();
	if (existing) {
		db.update(drizzleSchedulerRuns)
			.set(values)
			.where(drizzleEq(drizzleSchedulerRuns.id, id))
			.run();
	} else {
		db.insert(drizzleSchedulerRuns).values(values).run();
	}
}

function deleteReminderFromLegacy(id: number) {
	db.delete(drizzleReminders).where(drizzleEq(drizzleReminders.id, id)).run();
}

function deleteNotificationFromLegacy(id: number) {
	db.delete(drizzleNotifications).where(drizzleEq(drizzleNotifications.id, id)).run();
}

function deleteSchedulerRunFromLegacy(id: number) {
	db.delete(drizzleSchedulerRuns).where(drizzleEq(drizzleSchedulerRuns.id, id)).run();
}

function reminderFromLegacy(id: number): ReminderRow | null {
	const row = db.select().from(drizzleReminders).where(drizzleEq(drizzleReminders.id, id)).get();
	return row ?? null;
}

function reminderFromLegacyBySource(
	kind: string,
	refType: string,
	refId: number
): ReminderRow | null {
	const row = db
		.select()
		.from(drizzleReminders)
		.where(
			drizzleAnd(
				drizzleEq(drizzleReminders.kind, kind),
				drizzleEq(drizzleReminders.refType, refType),
				drizzleEq(drizzleReminders.refId, refId)
			)
		)
		.get();
	return row ?? null;
}

function notificationFromLegacy(id: number): NotificationRow | null {
	const row = db.select().from(drizzleNotifications).where(drizzleEq(drizzleNotifications.id, id)).get();
	return row ?? null;
}

function schedulerRunFromLegacy(id: number): SchedulerRunRow | null {
	const row = db.select().from(drizzleSchedulerRuns).where(drizzleEq(drizzleSchedulerRuns.id, id)).get();
	return row ?? null;
}

function mergeUniqueById<T extends { id: number }>(kitRows: T[], legacyRows: T[]): T[] {
	const seen = new Set(kitRows.map((r) => r.id));
	const merged = [...kitRows];
	for (const row of legacyRows) {
		if (!seen.has(row.id)) {
			merged.push(row);
			seen.add(row.id);
		}
	}
	return merged;
}

// Reminders

export type CreateReminderInput = Pick<ReminderRow, 'userId' | 'kind' | 'refType' | 'refId' | 'fireAt'> &
	Partial<Pick<ReminderRow, 'status' | 'attempts' | 'sentAt'>>;

export type UpdateReminderInput = Partial<Omit<ReminderRow, 'id' | 'createdAt'>>;

function listRemindersForUserQuery(userId: number): ReminderRow[] {
	const kitRows = kit
		.selectFrom(kitReminders)
		.where(kitEq(kitReminders.user_id, toBigInt(userId)))
		.orderBy(kitDesc(kitReminders.fire_at), kitDesc(kitReminders.id))
		.executeSync()
		.map(toReminderRow);

	const legacyRows = db
		.select()
		.from(drizzleReminders)
		.where(drizzleEq(drizzleReminders.userId, userId))
		.orderBy(drizzleReminders.fireAt)
		.all();

	const kitIds = new Set(kitRows.map((r) => r.id));
	const merged = [...kitRows, ...legacyRows.filter((r) => !kitIds.has(r.id))];
	merged.sort((a, b) => {
		if (a.fireAt > b.fireAt) return -1;
		if (a.fireAt < b.fireAt) return 1;
		return b.id - a.id;
	});
	return merged;
}

export function listRemindersForUser(userId: number): ReminderRow[] {
	return listRemindersForUserQuery(userId);
}

export function listPendingRemindersBefore(fireAt: string): ReminderRow[] {
	const statuses: ReminderRow['status'][] = ['pending', 'sending'];
	const kitRows = kit
		.selectFrom(kitReminders)
		.where(
			kitAnd(
				kitInList(kitReminders.status, statuses),
				kitLte(kitReminders.fire_at, fireAt)
			)
		)
		.orderBy(kitAsc(kitReminders.fire_at))
		.executeSync()
		.map(toReminderRow);

	const legacyRows = db
		.select()
		.from(drizzleReminders)
		.where(
			drizzleAnd(
				drizzleInArray(drizzleReminders.status, statuses),
				drizzleLte(drizzleReminders.fireAt, fireAt)
			)
		)
		.orderBy(drizzleReminders.fireAt)
		.all();

	const kitIds = new Set(kitRows.map((r) => r.id));
	const merged = [...kitRows, ...legacyRows.filter((r) => !kitIds.has(r.id))];
	merged.sort((a, b) => a.fireAt.localeCompare(b.fireAt));
	return merged;
}

export function getReminderById(id: number): ReminderRow | null {
	const rows = kit.selectFrom(kitReminders).where(kitEq(kitReminders.id, toBigInt(id))).executeSync();
	if (rows[0]) return toReminderRow(rows[0]);
	return reminderFromLegacy(id);
}

export function getReminderBySource(
	kind: string,
	refType: string,
	refId: number
): ReminderRow | null {
	const rows = kit
		.selectFrom(kitReminders)
		.where(
			kitAnd(
				kitEq(kitReminders.kind, kind),
				kitEq(kitReminders.ref_type, refType),
				kitEq(kitReminders.ref_id, toBigInt(refId))
			)
		)
		.executeSync();
	if (rows[0]) return toReminderRow(rows[0]);
	return reminderFromLegacyBySource(kind, refType, refId);
}

export function createReminder(input: CreateReminderInput): ReminderRow {
	const row = kit
		.insertInto(kitReminders)
		.values({
			user_id: toBigInt(input.userId),
			kind: input.kind,
			ref_type: input.refType,
			ref_id: toBigInt(input.refId),
			fire_at: input.fireAt,
			status: input.status ?? 'pending',
			attempts: BigInt(input.attempts ?? 0),
			sent_at: input.sentAt ?? null
		} as Insert<typeof kitReminders>)
		.executeSync();
	syncReminderToLegacy(row);
	return toReminderRow(row);
}

export function upsertReminderBySource(input: CreateReminderInput): ReminderRow {
	const existing = getReminderBySource(input.kind, input.refType, input.refId);
	if (existing) {
		return updateReminder(existing.id, {
			fireAt: input.fireAt,
			status: input.status ?? 'pending',
			attempts: input.attempts ?? 0,
			sentAt: input.sentAt ?? null
		})!;
	}
	return createReminder(input);
}

export function updateReminder(id: number, patch: UpdateReminderInput): ReminderRow | null {
	const existing = kit.selectFrom(kitReminders).where(kitEq(kitReminders.id, toBigInt(id))).executeSync()[0];
	if (!existing) return null;

	const { id: _existingId, ...existingRest } = existing;
	const merged: Update<typeof kitReminders> = { ...existingRest };
	if (patch.userId !== undefined) merged.user_id = toBigInt(patch.userId);
	if (patch.kind !== undefined) merged.kind = patch.kind;
	if (patch.refType !== undefined) merged.ref_type = patch.refType;
	if (patch.refId !== undefined) merged.ref_id = toBigInt(patch.refId);
	if (patch.fireAt !== undefined) merged.fire_at = patch.fireAt;
	if (patch.status !== undefined) merged.status = patch.status;
	if (patch.attempts !== undefined) merged.attempts = BigInt(patch.attempts);
	if (patch.sentAt !== undefined) merged.sent_at = patch.sentAt ?? null;

	const updated = kit
		.updateTable(kitReminders)
		.set(merged)
		.where(kitEq(kitReminders.id, toBigInt(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	syncReminderToLegacy(row);
	return toReminderRow(row);
}

export function deleteReminder(id: number): boolean {
	const deleted = kit.deleteFrom(kitReminders).where(kitEq(kitReminders.id, toBigInt(id))).executeSync();
	deleteReminderFromLegacy(id);
	return deleted > 0n || reminderFromLegacy(id) !== null;
}

export function deleteRemindersForRef(refType: string, refId: number): bigint {
	const ids = kit
		.selectFrom(kitReminders)
		.where(
			kitAnd(kitEq(kitReminders.ref_type, refType), kitEq(kitReminders.ref_id, toBigInt(refId)))
		)
		.executeSync()
		.map((r) => num(r.id));
	const deleted = kit
		.deleteFrom(kitReminders)
		.where(
			kitAnd(kitEq(kitReminders.ref_type, refType), kitEq(kitReminders.ref_id, toBigInt(refId)))
		)
		.executeSync();
	for (const id of ids) {
		deleteReminderFromLegacy(id);
	}
	return deleted;
}

export function markReminderSent(id: number, sentAt = nowIso()): ReminderRow | null {
	return updateReminder(id, { status: 'sent', sentAt, attempts: 0 });
}

// Notifications

export type CreateNotificationInput = Pick<NotificationRow, 'userId' | 'title' | 'body'> &
	Partial<Pick<NotificationRow, 'link'>>;

export type UpdateNotificationInput = Partial<Omit<NotificationRow, 'id' | 'createdAt'>>;

export interface ListNotificationsOptions {
	limit?: number;
	includeRead?: boolean;
}

export function listNotificationsForUser(userId: number, opts: ListNotificationsOptions = {}): NotificationRow[] {
	const includeRead = opts.includeRead ?? true;
	const limit = opts.limit;

	const kitConditions = [kitEq(kitNotifications.user_id, toBigInt(userId))];
	if (!includeRead) kitConditions.push(kitIsNull(kitNotifications.read_at));
	const kitRows = kit
		.selectFrom(kitNotifications)
		.where(kitAnd(...kitConditions))
		.orderBy(kitDesc(kitNotifications.created_at), kitDesc(kitNotifications.id))
		.executeSync()
		.map(toNotificationRow);

	const legacyConditions = [drizzleEq(drizzleNotifications.userId, userId)];
	if (!includeRead) legacyConditions.push(drizzleIsNull(drizzleNotifications.readAt));
	const legacyRows = db
		.select()
		.from(drizzleNotifications)
		.where(drizzleAnd(...legacyConditions))
		.orderBy(drizzleNotifications.createdAt)
		.all();

	const kitIds = new Set(kitRows.map((r) => r.id));
	const merged = [...kitRows, ...legacyRows.filter((r) => !kitIds.has(r.id))];
	merged.sort((a, b) => {
		if (a.createdAt > b.createdAt) return -1;
		if (a.createdAt < b.createdAt) return 1;
		return b.id - a.id;
	});
	return limit != null ? merged.slice(0, limit) : merged;
}

export function countUnreadNotificationsForUser(userId: number): number {
	return countNotificationsForUser(userId, { unreadOnly: true });
}

export function countNotificationsForUser(userId: number, opts: { unreadOnly?: boolean } = {}): number {
	const unreadOnly = opts.unreadOnly ?? false;
	const kitPredicates = [kitEq(kitNotifications.user_id, toBigInt(userId))];
	const legacyPredicates = [drizzleEq(drizzleNotifications.userId, userId)];
	if (unreadOnly) {
		kitPredicates.push(kitIsNull(kitNotifications.read_at));
		legacyPredicates.push(drizzleIsNull(drizzleNotifications.readAt));
	}

	const kitCount = Number(
		kit
			.selectFrom(kitNotifications)
			.selectCount()
			.where(kitAnd(...kitPredicates))
			.executeSync()
	);

	const kitIds = (
		kit
			.selectFrom(kitNotifications)
			.where(kitAnd(...kitPredicates))
			.executeSync() as KitNotification[]
	).map((r) => num(r.id));

	if (kitIds.length === 0) {
		const legacyRow = db
			.select({ count: drizzleCount() })
			.from(drizzleNotifications)
			.where(drizzleAnd(...legacyPredicates))
			.get();
		return legacyRow?.count ?? 0;
	}

	const legacyRow = db
		.select({ count: drizzleCount() })
		.from(drizzleNotifications)
		.where(
			drizzleAnd(
				...legacyPredicates,
				drizzleNot(drizzleInArray(drizzleNotifications.id, kitIds))
			)
		)
		.get();
	return kitCount + (legacyRow?.count ?? 0);
}

export function countNotifications(): number {
	const kitCount = Number(kit.selectFrom(kitNotifications).selectCount().executeSync());
	const kitIds = (kit.selectFrom(kitNotifications).executeSync() as KitNotification[]).map((r) =>
		num(r.id)
	);
	if (kitIds.length === 0) {
		const legacyRow = db.select({ count: drizzleCount() }).from(drizzleNotifications).get();
		return legacyRow?.count ?? 0;
	}
	const legacyRow = db
		.select({ count: drizzleCount() })
		.from(drizzleNotifications)
		.where(drizzleNot(drizzleInArray(drizzleNotifications.id, kitIds)))
		.get();
	return kitCount + (legacyRow?.count ?? 0);
}

export function getNotificationById(id: number): NotificationRow | null {
	const rows = kit
		.selectFrom(kitNotifications)
		.where(kitEq(kitNotifications.id, toBigInt(id)))
		.executeSync();
	if (rows[0]) return toNotificationRow(rows[0]);
	return notificationFromLegacy(id);
}

export function createNotification(input: CreateNotificationInput): NotificationRow {
	const row = kit
		.insertInto(kitNotifications)
		.values({
			user_id: toBigInt(input.userId),
			title: input.title,
			body: input.body,
			link: input.link ?? null
		} as Insert<typeof kitNotifications>)
		.executeSync();
	syncNotificationToLegacy(row);
	return toNotificationRow(row);
}

export function updateNotification(id: number, patch: UpdateNotificationInput): NotificationRow | null {
	const existing = kit
		.selectFrom(kitNotifications)
		.where(kitEq(kitNotifications.id, toBigInt(id)))
		.executeSync()[0];
	if (!existing) return null;

	const { id: _existingId, ...existingRest } = existing;
	const merged: Update<typeof kitNotifications> = { ...existingRest };
	if (patch.userId !== undefined) merged.user_id = toBigInt(patch.userId);
	if (patch.title !== undefined) merged.title = patch.title;
	if (patch.body !== undefined) merged.body = patch.body;
	if (patch.link !== undefined) merged.link = patch.link ?? null;
	if (patch.readAt !== undefined) merged.read_at = patch.readAt ?? null;

	const updated = kit
		.updateTable(kitNotifications)
		.set(merged)
		.where(kitEq(kitNotifications.id, toBigInt(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	syncNotificationToLegacy(row);
	return toNotificationRow(row);
}

export function markNotificationRead(id: number, readAt = nowIso()): NotificationRow | null {
	return updateNotification(id, { readAt });
}

export function markNotificationUnread(id: number): NotificationRow | null {
	return updateNotification(id, { readAt: null });
}

export function deleteNotification(id: number): boolean {
	const deleted = kit
		.deleteFrom(kitNotifications)
		.where(kitEq(kitNotifications.id, toBigInt(id)))
		.executeSync();
	deleteNotificationFromLegacy(id);
	return deleted > 0n || notificationFromLegacy(id) !== null;
}

export function deleteOldNotifications(before: string): bigint {
	const kitIds = (
		kit
			.selectFrom(kitNotifications)
			.where(kitLt(kitNotifications.created_at, before))
			.executeSync() as KitNotification[]
	).map((r) => num(r.id));
	const deleted = kit
		.deleteFrom(kitNotifications)
		.where(kitLt(kitNotifications.created_at, before))
		.executeSync();
	db.delete(drizzleNotifications)
		.where(drizzleLt(drizzleNotifications.createdAt, before))
		.run();
	for (const id of kitIds) {
		deleteNotificationFromLegacy(id);
	}
	return deleted;
}

// Scheduler runs

export type CreateSchedulerRunInput = Pick<SchedulerRunRow, 'startedAt' | 'success' | 'errorMessage' | 'finishedAt'>;

export type UpdateSchedulerRunInput = Partial<Omit<SchedulerRunRow, 'id'>>;

export function startSchedulerRun(_kind?: string): SchedulerRunRow {
	const row = kit
		.insertInto(kitSchedulerRuns)
		.values({
			started_at: nowIso(),
			finished_at: null,
			success: false,
			error_message: null
		} as Insert<typeof kitSchedulerRuns>)
		.executeSync();
	syncSchedulerRunToLegacy(row);
	return toSchedulerRunRow(row);
}

export function finishSchedulerRun(
	id: number,
	result: { success?: boolean; errorMessage?: string | null } = {}
): SchedulerRunRow | null {
	return updateSchedulerRun(id, {
		finishedAt: nowIso(),
		success: result.success ?? true,
		errorMessage: result.errorMessage ?? null
	});
}

export function updateSchedulerRun(id: number, patch: UpdateSchedulerRunInput): SchedulerRunRow | null {
	const existing = kit
		.selectFrom(kitSchedulerRuns)
		.where(kitEq(kitSchedulerRuns.id, toBigInt(id)))
		.executeSync()[0];
	if (!existing) return null;

	const { id: _existingId, ...existingRest } = existing;
	const merged: Update<typeof kitSchedulerRuns> = { ...existingRest };
	if (patch.startedAt !== undefined) merged.started_at = patch.startedAt;
	if (patch.finishedAt !== undefined) merged.finished_at = patch.finishedAt ?? null;
	if (patch.success !== undefined) merged.success = patch.success;
	if (patch.errorMessage !== undefined) merged.error_message = patch.errorMessage ?? null;

	const updated = kit
		.updateTable(kitSchedulerRuns)
		.set(merged)
		.where(kitEq(kitSchedulerRuns.id, toBigInt(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	syncSchedulerRunToLegacy(row);
	return toSchedulerRunRow(row);
}

export function listRecentSchedulerRuns(limit: number): SchedulerRunRow[] {
	const kitRows = kit
		.selectFrom(kitSchedulerRuns)
		.orderBy(kitDesc(kitSchedulerRuns.started_at), kitDesc(kitSchedulerRuns.id))
		.executeSync()
		.map(toSchedulerRunRow);

	const legacyRows = db
		.select()
		.from(drizzleSchedulerRuns)
		.orderBy(drizzleSchedulerRuns.startedAt)
		.all();

	const kitIds = new Set(kitRows.map((r) => r.id));
	const merged = [...kitRows, ...legacyRows.filter((r) => !kitIds.has(r.id))];
	merged.sort((a, b) => {
		if (a.startedAt > b.startedAt) return -1;
		if (a.startedAt < b.startedAt) return 1;
		return b.id - a.id;
	});
	return merged.slice(0, limit);
}

export function pruneOldSchedulerRuns(before: string): bigint {
	const kitIds = (
		kit
			.selectFrom(kitSchedulerRuns)
			.where(kitLt(kitSchedulerRuns.started_at, before))
			.executeSync() as KitSchedulerRun[]
	).map((r) => num(r.id));
	const deleted = kit
		.deleteFrom(kitSchedulerRuns)
		.where(kitLt(kitSchedulerRuns.started_at, before))
		.executeSync();
	db.delete(drizzleSchedulerRuns)
		.where(drizzleLt(drizzleSchedulerRuns.startedAt, before))
		.run();
	for (const id of kitIds) {
		deleteSchedulerRunFromLegacy(id);
	}
	return deleted;
}
