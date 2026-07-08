import {
	eq as kitEq,
	and as kitAnd,
	inList as kitInList,
	asc as kitAsc,
	desc as kitDesc,
	lte as kitLte,
	lt as kitLt,
	isNull as kitIsNull,
} from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import {
	reminders as kitReminders,
	notifications as kitNotifications,
	schedulerRuns as kitSchedulerRuns
} from '$lib/server/db/mongrelSchema';
import type { Row, Insert, Update } from '@visorcraft/mongreldb-kit';
import { nowIso } from '$lib/server/tz';
import { compareRows } from '$lib/server/sortUtils';

export interface ReminderRow {
	id: number;
	userId: number;
	kind: 'flight_checkin' | 'document_expiry' | 'custom';
	refType: 'segment' | 'document' | 'trip';
	refId: number;
	fireAt: string;
	status: 'pending' | 'sending' | 'sent';
	attempts: number;
	sentAt: string | null;
	name: string | null;
	description: string | null;
	createdAt: string;
}

export interface NotificationRow {
	id: number;
	userId: number;
	title: string;
	body: string;
	link: string | null;
	createdAt: string;
	readAt: string | null;
}

export interface SchedulerRunRow {
	id: number;
	startedAt: string;
	finishedAt: string | null;
	success: boolean;
	errorMessage: string | null;
}

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
		name: row.name ?? null,
		description: row.description ?? null,
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

function schedulerRunMatchesSearch(row: SchedulerRunRow, q: string): boolean {
	return (
		row.startedAt.toLowerCase().includes(q) ||
		(row.finishedAt?.toLowerCase().includes(q) ?? false) ||
		(row.errorMessage?.toLowerCase().includes(q) ?? false) ||
		(q === 'success' && row.success) ||
		(q === 'failure' && !row.success)
	);
}

// Reminders

export type CreateReminderInput = Pick<ReminderRow, 'userId' | 'kind' | 'refType' | 'refId' | 'fireAt'> &
	Partial<Pick<ReminderRow, 'status' | 'attempts' | 'sentAt' | 'name' | 'description'>>;

export type UpdateReminderInput = Partial<Omit<ReminderRow, 'id' | 'createdAt'>>;

export function listRemindersForUser(userId: number): ReminderRow[] {
	const rows = kit
		.selectFrom(kitReminders)
		.where(kitEq(kitReminders.user_id, toBigInt(userId)))
		.orderBy(kitDesc(kitReminders.fire_at), kitDesc(kitReminders.id))
		.executeSync();
	return rows.map(toReminderRow);
}

export interface ListRemindersOptions {
	search?: string;
	sortBy?: 'fireAt' | 'status' | 'kind' | 'name' | 'createdAt';
	sortDir?: 'asc' | 'desc';
	from?: string;
	to?: string;
	statuses?: Array<ReminderRow['status']>;
	limit?: number;
	offset?: number;
}

function matchesReminderDateRange(value: string, from?: string, to?: string): boolean {
	const date = value.slice(0, 10);
	return (!from || date >= from) && (!to || date <= to);
}

export function listReminders(userId: number, opts: ListRemindersOptions = {}): ReminderRow[] {
	let rows = listRemindersForUser(userId);
	const q = opts.search?.trim().toLowerCase();
	if (q) {
		rows = rows.filter(
			(r) =>
				(r.name?.toLowerCase().includes(q) ?? false) ||
				(r.description?.toLowerCase().includes(q) ?? false) ||
				r.kind.toLowerCase().includes(q) ||
				r.status.toLowerCase().includes(q)
		);
	}
	if (opts.statuses && opts.statuses.length) {
		const set = new Set(opts.statuses);
		rows = rows.filter((r) => set.has(r.status));
	}
	rows = rows.filter((r) => matchesReminderDateRange(r.fireAt, opts.from, opts.to));
	const sortBy = opts.sortBy ?? 'fireAt';
	const sortDir = opts.sortDir ?? 'asc';
	rows = rows.slice().sort((a, b) => compareRows(a, b, sortBy, sortDir));
	const offset = opts.offset ?? 0;
	const limit = opts.limit ?? rows.length;
	return rows.slice(offset, offset + limit);
}

export function countReminders(
	userId: number,
	opts: { search?: string; from?: string; to?: string; statuses?: Array<ReminderRow['status']> } = {}
): number {
	const q = opts.search?.trim().toLowerCase();
	const hasFilters = Boolean(q || opts.from || opts.to || (opts.statuses && opts.statuses.length));
	if (!hasFilters) {
		return Number(
			kit
				.selectFrom(kitReminders)
				.where(kitEq(kitReminders.user_id, toBigInt(userId)))
				.selectCount()
				.executeSync()
		);
	}
	const set = opts.statuses && opts.statuses.length ? new Set(opts.statuses) : null;
	return listRemindersForUser(userId).filter(
		(r) =>
			matchesReminderDateRange(r.fireAt, opts.from, opts.to) &&
			(!set || set.has(r.status)) &&
			(!q ||
				(r.name?.toLowerCase().includes(q) ?? false) ||
				(r.description?.toLowerCase().includes(q) ?? false) ||
				r.kind.toLowerCase().includes(q) ||
				r.status.toLowerCase().includes(q))
	).length;
}

export function listPendingRemindersBefore(fireAt: string): ReminderRow[] {
	const statuses: ReminderRow['status'][] = ['pending', 'sending'];
	return kit
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
}

export function getReminderById(id: number): ReminderRow | null {
	const rows = kit.selectFrom(kitReminders).where(kitEq(kitReminders.id, toBigInt(id))).executeSync();
	return rows[0] ? toReminderRow(rows[0]) : null;
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
	return rows[0] ? toReminderRow(rows[0]) : null;
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
			sent_at: input.sentAt ?? null,
			name: input.name ?? null,
			description: input.description ?? null
		} as Insert<typeof kitReminders>)
		.executeSync();
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
	if (patch.name !== undefined) merged.name = patch.name ?? null;
	if (patch.description !== undefined) merged.description = patch.description ?? null;

	const updated = kit
		.updateTable(kitReminders)
		.set(merged)
		.where(kitEq(kitReminders.id, toBigInt(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	return toReminderRow(row);
}

/**
 * User-facing edit. Updates only descriptive/scheduling fields. Never touches
 * status / sent_at / attempts — once a reminder has fired, editing its name,
 * description, fire_at, or ref must NOT re-arm it. Only the scheduler marks
 * reminders sent; only delete + recreate can make a fired reminder fire again.
 */
export function updateReminderUserFields(
	id: number,
	patch: {
		name?: string | null;
		description?: string | null;
		fireAt?: string;
		kind?: ReminderRow['kind'];
		refType?: ReminderRow['refType'];
		refId?: number;
	}
): ReminderRow | null {
	const existing = kit.selectFrom(kitReminders).where(kitEq(kitReminders.id, toBigInt(id))).executeSync()[0];
	if (!existing) return null;

	const { id: _existingId, ...existingRest } = existing;
	const merged: Update<typeof kitReminders> = { ...existingRest };
	if (patch.kind !== undefined) merged.kind = patch.kind;
	if (patch.refType !== undefined) merged.ref_type = patch.refType;
	if (patch.refId !== undefined) merged.ref_id = toBigInt(patch.refId);
	if (patch.fireAt !== undefined) merged.fire_at = patch.fireAt;
	if (patch.name !== undefined) merged.name = patch.name ?? null;
	if (patch.description !== undefined) merged.description = patch.description ?? null;

	const updated = kit
		.updateTable(kitReminders)
		.set(merged)
		.where(kitEq(kitReminders.id, toBigInt(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	return toReminderRow(row);
}

export function deleteReminder(id: number): boolean {
	const deleted = kit.deleteFrom(kitReminders).where(kitEq(kitReminders.id, toBigInt(id))).executeSync();
	return deleted > 0n;
}

export function deleteRemindersForRef(refType: string, refId: number): bigint {
	return kit
		.deleteFrom(kitReminders)
		.where(
			kitAnd(kitEq(kitReminders.ref_type, refType), kitEq(kitReminders.ref_id, toBigInt(refId)))
		)
		.executeSync();
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

	const conditions = [kitEq(kitNotifications.user_id, toBigInt(userId))];
	if (!includeRead) conditions.push(kitIsNull(kitNotifications.read_at));

	const rows = kit
		.selectFrom(kitNotifications)
		.where(kitAnd(...conditions))
		.orderBy(kitDesc(kitNotifications.created_at), kitDesc(kitNotifications.id))
		.executeSync()
		.map(toNotificationRow);

	return limit != null ? rows.slice(0, limit) : rows;
}

export function countUnreadNotificationsForUser(userId: number): number {
	return countNotificationsForUser(userId, { unreadOnly: true });
}

export function countNotificationsForUser(userId: number, opts: { unreadOnly?: boolean } = {}): number {
	const unreadOnly = opts.unreadOnly ?? false;
	const predicates = [kitEq(kitNotifications.user_id, toBigInt(userId))];
	if (unreadOnly) {
		predicates.push(kitIsNull(kitNotifications.read_at));
	}
	return Number(
		kit
			.selectFrom(kitNotifications)
			.selectCount()
			.where(kitAnd(...predicates))
			.executeSync()
	);
}

export function countNotifications(): number {
	return Number(kit.selectFrom(kitNotifications).selectCount().executeSync());
}

export function getNotificationById(id: number): NotificationRow | null {
	const rows = kit
		.selectFrom(kitNotifications)
		.where(kitEq(kitNotifications.id, toBigInt(id)))
		.executeSync();
	return rows[0] ? toNotificationRow(rows[0]) : null;
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
	return deleted > 0n;
}

// Scheduler runs

type UpdateSchedulerRunInput = Partial<Omit<SchedulerRunRow, 'id'>>;

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
	return toSchedulerRunRow(row);
}

export function listRecentSchedulerRuns(limit: number): SchedulerRunRow[] {
	return kit
		.selectFrom(kitSchedulerRuns)
		.orderBy(kitDesc(kitSchedulerRuns.started_at), kitDesc(kitSchedulerRuns.id))
		.executeSync()
		.slice(0, limit)
		.map(toSchedulerRunRow);
}

export interface ListSchedulerRunsOptions {
	search?: string;
	sortBy?: 'startedAt';
	sortDir?: 'asc' | 'desc';
	limit?: number;
	offset?: number;
	from?: string;
	to?: string;
}

function matchesSchedulerRunDateRange(row: SchedulerRunRow, from?: string, to?: string): boolean {
	const date = row.startedAt.slice(0, 10);
	return (!from || date >= from) && (!to || date <= to);
}

export function listSchedulerRuns(opts: ListSchedulerRunsOptions = {}): SchedulerRunRow[] {
	let rows = kit
		.selectFrom(kitSchedulerRuns)
		.orderBy(kitDesc(kitSchedulerRuns.started_at), kitDesc(kitSchedulerRuns.id))
		.executeSync()
		.map(toSchedulerRunRow);
	const q = opts.search?.trim().toLowerCase();
	if (q) {
		rows = rows.filter((r) => schedulerRunMatchesSearch(r, q));
	}
	rows = rows.filter((r) => matchesSchedulerRunDateRange(r, opts.from, opts.to));
	const sortBy = opts.sortBy ?? 'startedAt';
	const sortDir = opts.sortDir ?? 'desc';
	rows = rows.slice().sort((a, b) => compareRows(a, b, sortBy, sortDir));
	const offset = opts.offset ?? 0;
	const limit = opts.limit ?? rows.length;
	return rows.slice(offset, offset + limit);
}

export function countSchedulerRuns(search?: string, from?: string, to?: string): number {
	if (!search?.trim() && !from && !to) {
		return Number(kit.selectFrom(kitSchedulerRuns).selectCount().executeSync());
	}
	const q = search?.trim().toLowerCase();
	return kit
		.selectFrom(kitSchedulerRuns)
		.executeSync()
		.map(toSchedulerRunRow)
		.filter((r) => matchesSchedulerRunDateRange(r, from, to) && (!q || schedulerRunMatchesSearch(r, q)))
		.length;
}

export function pruneOldSchedulerRuns(before: string): bigint {
	return kit
		.deleteFrom(kitSchedulerRuns)
		.where(kitLt(kitSchedulerRuns.started_at, before))
		.executeSync();
}
