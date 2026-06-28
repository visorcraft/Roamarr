import { eq as kitEq, and as kitAnd, gte as kitGte, lte as kitLte, desc as kitDesc } from '@mongreldb/kit';
import { countNotifications } from './remindersRepo';
import {
	eq as drizzleEq,
	and as drizzleAnd,
	gte as drizzleGte,
	lte as drizzleLte,
	desc as drizzleDesc,
	sql
} from 'drizzle-orm';
import { db, kit } from '$lib/server/db';
import { auditLogs as kitAuditLogs, users as kitUsers } from '$lib/server/db/mongrelSchema';
import { auditLogs as drizzleAuditLogs, users as drizzleUsers, trips, segments, groups } from '$lib/server/db/schema';
import type { Row, Insert, Update } from '@mongreldb/kit';

export type KitAuditLog = Row<typeof kitAuditLogs>;

interface AuditMeta {
	[key: string]: unknown;
}

export interface AuditLogEntry {
	id: number;
	action: string;
	entityType: string;
	entityId: number;
	meta: AuditMeta;
	createdAt: string;
	user: {
		id: number;
		email: string;
		displayName: string;
	};
}

export interface AuditFilters {
	userId?: number;
	action?: string;
	entityType?: string;
	from?: string;
	to?: string;
	limit?: number;
	offset?: number;
}

export interface AuditListResult {
	logs: AuditLogEntry[];
	total: number;
}

export interface AdminStats {
	users: number;
	trips: number;
	segments: number;
	groups: number;
	notifications: number;
}

function toBigInt(id: number): bigint {
	return BigInt(id);
}

function idFromBigInt(id: bigint): number {
	return Number(id);
}

function kitAuditToDrizzleRow(row: KitAuditLog): typeof drizzleAuditLogs.$inferInsert {
	return {
		id: idFromBigInt(row.id),
		userId: idFromBigInt(row.user_id),
		action: row.action,
		entityType: row.entity_type,
		entityId: idFromBigInt(row.entity_id),
		metaJson: row.meta_json as string,
		createdAt: row.created_at
	};
}

function syncAuditLogToLegacy(row: KitAuditLog) {
	const existing = db
		.select()
		.from(drizzleAuditLogs)
		.where(drizzleEq(drizzleAuditLogs.id, idFromBigInt(row.id)))
		.get();
	if (existing) {
		db.update(drizzleAuditLogs)
			.set(kitAuditToDrizzleRow(row))
			.where(drizzleEq(drizzleAuditLogs.id, idFromBigInt(row.id)))
			.run();
	} else {
		db.insert(drizzleAuditLogs).values(kitAuditToDrizzleRow(row)).run();
	}
}

export function logAudit(
	userId: number,
	action: string,
	entityType: string,
	entityId: number,
	meta: AuditMeta = {}
) {
	const row = kit
		.insertInto(kitAuditLogs)
		.values({
			user_id: toBigInt(userId),
			action,
			entity_type: entityType,
			entity_id: toBigInt(entityId),
			meta_json: JSON.stringify(meta)
		} as Insert<typeof kitAuditLogs>)
		.executeSync();
	syncAuditLogToLegacy(row);
}

function buildKitConditions(filters: AuditFilters) {
	const conditions: ReturnType<typeof kitEq>[] = [];
	if (filters.userId != null) conditions.push(kitEq(kitAuditLogs.user_id, toBigInt(filters.userId)));
	if (filters.action) conditions.push(kitEq(kitAuditLogs.action, filters.action));
	if (filters.entityType) conditions.push(kitEq(kitAuditLogs.entity_type, filters.entityType));
	if (filters.from) conditions.push(kitGte(kitAuditLogs.created_at, filters.from));
	if (filters.to) conditions.push(kitLte(kitAuditLogs.created_at, filters.to));
	return conditions;
}

function buildDrizzleConditions(filters: AuditFilters) {
	const conditions = [];
	if (filters.userId != null) conditions.push(drizzleEq(drizzleAuditLogs.userId, filters.userId));
	if (filters.action) conditions.push(drizzleEq(drizzleAuditLogs.action, filters.action));
	if (filters.entityType) conditions.push(drizzleEq(drizzleAuditLogs.entityType, filters.entityType));
	if (filters.from) conditions.push(drizzleGte(drizzleAuditLogs.createdAt, filters.from));
	if (filters.to) conditions.push(drizzleLte(drizzleAuditLogs.createdAt, filters.to));
	return conditions;
}

function totalAuditLogs(filters: AuditFilters): number {
	const kitConditions = buildKitConditions(filters);
	const kitCountQuery = kit.selectFrom(kitAuditLogs).selectCount();
	const kitCount = Number(
		(kitConditions.length
			? kitCountQuery.where(kitAnd(...kitConditions))
			: kitCountQuery
		).executeSync()
	);

	const drizzleConditions = buildDrizzleConditions(filters);
	const drizzleRow = db
		.select({ count: sql<number>`count(*)` })
		.from(drizzleAuditLogs)
		.where(drizzleConditions.length ? drizzleAnd(...drizzleConditions) : undefined)
		.get();
	const drizzleCount = drizzleRow?.count ?? 0;

	// Avoid double-counting rows that were already mirrored from kit to legacy.
	const kitIdsQuery = kit.selectFrom(kitAuditLogs);
	const kitIds = (
		(kitConditions.length
			? kitIdsQuery.where(kitAnd(...kitConditions))
			: kitIdsQuery
		).executeSync() as KitAuditLog[]
	).map((r) => idFromBigInt(r.id));
	let overlap = 0;
	if (kitIds.length) {
		overlap =
			db
				.select({ count: sql<number>`count(*)` })
				.from(drizzleAuditLogs)
				.where(
					drizzleAnd(
						drizzleConditions.length ? drizzleAnd(...drizzleConditions) : undefined,
						drizzleEq(drizzleAuditLogs.id, 0) // placeholder; replaced below with inArray when ids exist
					)
				)
				.get()?.count ?? 0;
		// Recompute properly with inArray.
		overlap =
			db
				.select({ count: sql<number>`count(*)` })
				.from(drizzleAuditLogs)
				.where(
					drizzleAnd(
						...(drizzleConditions.length ? drizzleConditions : []),
						drizzleEq(drizzleAuditLogs.id, 0) // will be replaced
					)
				)
				.get()?.count ?? 0;
		const stmt = db
			.select({ count: sql<number>`count(*)` })
			.from(drizzleAuditLogs)
			.where(
				drizzleAnd(
					...(drizzleConditions.length ? drizzleConditions : []),
					drizzleEq(drizzleAuditLogs.id, 0)
				)
			);
		// Use a raw parameter approach for the id list.
		const idList = kitIds.join(',');
		overlap =
			(db as any)
				.$client.prepare(
					`SELECT count(*) AS count FROM audit_logs WHERE ${
						drizzleConditions.length
							? drizzleConditions.map(() => '1=1').join(' AND ')
							: '1=1'
					} AND id IN (${idList})`
				)
				.get()?.count ?? 0;
	}

	return kitCount + drizzleCount - overlap;
}

function hydrateUsers(userIds: number[]): Map<number, { id: number; email: string; displayName: string }> {
	const uniqueIds = Array.from(new Set(userIds));
	if (uniqueIds.length === 0) return new Map();
	// Fetch all kit users by id list if available; otherwise fall back to per-id.
	const users = uniqueIds.length
		? (kit as any).selectFrom(kitUsers).where((kitUsers.id as any).in(uniqueIds)).executeSync()
		: [];
	const map = new Map<number, { id: number; email: string; displayName: string }>();
	for (const u of users) {
		const id = idFromBigInt(u.id);
		map.set(id, { id, email: u.email, displayName: u.display_name });
	}
	// Fill any missing from legacy (users may still be created directly in legacy during migration).
	const missing = uniqueIds.filter((id) => !map.has(id));
	if (missing.length) {
		const idList = missing.join(',');
		const legacyRows = (db as any)
			.$client.prepare(`SELECT id, email, display_name FROM users WHERE id IN (${idList})`)
			.all();
		for (const u of legacyRows) {
			map.set(u.id, { id: u.id, email: u.email, displayName: u.display_name });
		}
	}
	return map;
}

export function listAuditLogs(filters: AuditFilters = {}): AuditListResult {
	const limit = filters.limit ?? 100;
	const offset = filters.offset ?? 0;

	const kitConditions = buildKitConditions(filters);
	let kitRowsQuery = kit.selectFrom(kitAuditLogs);
	if (kitConditions.length) {
		kitRowsQuery = kitRowsQuery.where(kitAnd(...kitConditions));
	}
	const kitRows = kitRowsQuery
		.orderBy(kitDesc(kitAuditLogs.created_at), kitDesc(kitAuditLogs.id))
		.executeSync();

	const drizzleConditions = buildDrizzleConditions(filters);
	const drizzleRows = db
		.select()
		.from(drizzleAuditLogs)
		.where(drizzleConditions.length ? drizzleAnd(...drizzleConditions) : undefined)
		.orderBy(drizzleDesc(drizzleAuditLogs.createdAt), drizzleDesc(drizzleAuditLogs.id))
		.all();

	const kitIds = new Set(kitRows.map((r) => idFromBigInt(r.id)));
	const merged = [
		...kitRows.map((r) => ({
			id: idFromBigInt(r.id),
			action: r.action,
			entityType: r.entity_type,
			entityId: idFromBigInt(r.entity_id),
			metaJson: r.meta_json as string,
			createdAt: r.created_at,
			userId: idFromBigInt(r.user_id)
		})),
		...drizzleRows
			.filter((r) => !kitIds.has(r.id))
			.map((r) => ({
				id: r.id,
				action: r.action,
				entityType: r.entityType,
				entityId: r.entityId,
				metaJson: r.metaJson,
				createdAt: r.createdAt,
				userId: r.userId
			}))
	];

	merged.sort((a, b) => {
		if (a.createdAt > b.createdAt) return -1;
		if (a.createdAt < b.createdAt) return 1;
		return b.id - a.id;
	});

	const total = merged.length;
	const pageRows = merged.slice(offset, offset + limit);
	const userIds = pageRows.map((r) => r.userId);
	const userMap = hydrateUsers(userIds);

	const logs = pageRows.map((r) => ({
		id: r.id,
		action: r.action,
		entityType: r.entityType,
		entityId: r.entityId,
		meta: JSON.parse(r.metaJson) as AuditMeta,
		createdAt: r.createdAt,
		user: userMap.get(r.userId) ?? { id: r.userId, email: '', displayName: '' }
	}));

	return { logs, total };
}

function csvCell(value: unknown) {
	return `"${String(value).replace(/"/g, '""')}"`;
}

export function exportAuditLogsCsv(filters: AuditFilters = {}): string {
	const { logs } = listAuditLogs({ ...filters, limit: 10_000, offset: 0 });
	const header = ['id', 'action', 'entityType', 'entityId', 'userId', 'userEmail', 'userDisplayName', 'createdAt', 'meta'];
	const rows = logs.map((l) =>
		[
			l.id,
			l.action,
			l.entityType,
			l.entityId,
			l.user.id,
			l.user.email,
			l.user.displayName,
			l.createdAt,
			JSON.stringify(l.meta)
		].map(csvCell).join(',')
	);
	return [header.join(','), ...rows].join('\n') + '\n';
}

export function getAdminStats(): AdminStats {
	return {
		users: db.select({ count: sql<number>`count(*)` }).from(drizzleUsers).get()?.count ?? 0,
		trips: db.select({ count: sql<number>`count(*)` }).from(trips).get()?.count ?? 0,
		segments: db.select({ count: sql<number>`count(*)` }).from(segments).get()?.count ?? 0,
		groups: db.select({ count: sql<number>`count(*)` }).from(groups).get()?.count ?? 0,
		notifications: countNotifications()
	};
}
