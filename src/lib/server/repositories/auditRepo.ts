import {
	eq as kitEq,
	and as kitAnd,
	gte as kitGte,
	lte as kitLte,
	desc as kitDesc,
	inList as kitInList
} from '@mongreldb/kit';
import { eq as drizzleEq, inArray as drizzleInArray } from 'drizzle-orm';
import { db, kit } from '$lib/server/db';
import {
	auditLogs as kitAuditLogs,
	users as kitUsers,
	trips as kitTrips,
	groups as kitGroups
} from '$lib/server/db/mongrelSchema';
import { auditLogs as drizzleAuditLogs, users as drizzleUsers } from '$lib/server/db/schema';
import { countNotifications } from './remindersRepo';
import { countSegments } from './segmentsRepo';
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
	const values = kitAuditToDrizzleRow(row);
	const existing = db
		.select()
		.from(drizzleAuditLogs)
		.where(drizzleEq(drizzleAuditLogs.id, values.id!))
		.get();
	if (existing) {
		db.update(drizzleAuditLogs)
			.set(values)
			.where(drizzleEq(drizzleAuditLogs.id, values.id!))
			.run();
	} else {
		db.insert(drizzleAuditLogs).values(values).run();
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

function hydrateUsers(userIds: number[]): Map<number, { id: number; email: string; displayName: string }> {
	const uniqueIds = Array.from(new Set(userIds));
	if (uniqueIds.length === 0) return new Map();

	const rows = kit
		.selectFrom(kitUsers)
		.where(kitInList(kitUsers.id, uniqueIds.map(toBigInt)))
		.executeSync();
	const map = new Map<number, { id: number; email: string; displayName: string }>();
	for (const u of rows) {
		const id = idFromBigInt(u.id);
		map.set(id, { id, email: u.email, displayName: u.display_name });
	}

	const missing = uniqueIds.filter((id) => !map.has(id));
	if (missing.length) {
		const legacyRows = db
			.select({
				id: drizzleUsers.id,
				email: drizzleUsers.email,
				displayName: drizzleUsers.displayName
			})
			.from(drizzleUsers)
			.where(drizzleInArray(drizzleUsers.id, missing))
			.all();
		for (const u of legacyRows) {
			map.set(u.id, { id: u.id, email: u.email, displayName: u.displayName });
		}
	}
	return map;
}

export function listAuditLogs(filters: AuditFilters = {}): AuditListResult {
	const limit = filters.limit ?? 100;
	const offset = filters.offset ?? 0;

	const conditions = buildKitConditions(filters);
	const where = conditions.length ? kitAnd(...conditions) : undefined;

	const countQuery = kit.selectFrom(kitAuditLogs).selectCount();
	const total = Number((where ? countQuery.where(where) : countQuery).executeSync());

	let rowsQuery = kit
		.selectFrom(kitAuditLogs)
		.orderBy(kitDesc(kitAuditLogs.created_at), kitDesc(kitAuditLogs.id));
	if (where) {
		rowsQuery = rowsQuery.where(where);
	}
	const rows = rowsQuery.limit(limit).offset(offset).executeSync();

	const userIds = rows.map((r) => idFromBigInt(r.user_id));
	const userMap = hydrateUsers(userIds);

	const logs = rows.map((r) => ({
		id: idFromBigInt(r.id),
		action: r.action,
		entityType: r.entity_type,
		entityId: idFromBigInt(r.entity_id),
		meta: JSON.parse(r.meta_json as string) as AuditMeta,
		createdAt: r.created_at,
		user: userMap.get(idFromBigInt(r.user_id)) ?? {
			id: idFromBigInt(r.user_id),
			email: '',
			displayName: ''
		}
	}));

	return { logs, total };
}

function csvCell(value: unknown) {
	return `"${String(value).replace(/"/g, '""')}"`;
}

export function exportAuditLogsCsv(filters: AuditFilters = {}): string {
	const { logs } = listAuditLogs({ ...filters, limit: 10_000, offset: 0 });
	const header = [
		'id',
		'action',
		'entityType',
		'entityId',
		'userId',
		'userEmail',
		'userDisplayName',
		'createdAt',
		'meta'
	];
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
		]
			.map(csvCell)
			.join(',')
	);
	return [header.join(','), ...rows].join('\n') + '\n';
}

export function getAdminStats(): AdminStats {
	return {
		users: Number(kit.selectFrom(kitUsers).selectCount().executeSync()),
		trips: Number(kit.selectFrom(kitTrips).selectCount().executeSync()),
		segments: Number(countSegments()),
		groups: Number(kit.selectFrom(kitGroups).selectCount().executeSync()),
		notifications: countNotifications()
	};
}
