import {
	eq as kitEq,
	and as kitAnd,
	gte as kitGte,
	lte as kitLte,
	desc as kitDesc,
	inList as kitInList
} from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import {
	auditLogs as kitAuditLogs,
	users as kitUsers,
	trips as kitTrips,
	groups as kitGroups
} from '$lib/server/db/mongrelSchema';
import { countNotifications } from './remindersRepo';
import { countSegments } from './segmentsRepo';
import type { Row, Insert } from '@visorcraft/mongreldb-kit';

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
	search?: string;
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

export const AUDIT_SEARCH_SCAN_LIMIT = 10_000;

function toBigInt(id: number): bigint {
	return BigInt(id);
}

function idFromBigInt(id: bigint): number {
	return Number(id);
}



export function logAudit(
	userId: number,
	action: string,
	entityType: string,
	entityId: number,
	meta: AuditMeta = {}
) {
	kit
		.insertInto(kitAuditLogs)
		.values({
			user_id: toBigInt(userId),
			action,
			entity_type: entityType,
			entity_id: toBigInt(entityId),
			meta_json: JSON.stringify(meta)
		} as Insert<typeof kitAuditLogs>)
		.executeSync();
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

	return map;
}

function toAuditLogEntry(
	r: Row<typeof kitAuditLogs>,
	userMap: Map<number, { id: number; email: string; displayName: string }>
): AuditLogEntry {
	const userId = idFromBigInt(r.user_id);
	return {
		id: idFromBigInt(r.id),
		action: r.action,
		entityType: r.entity_type,
		entityId: idFromBigInt(r.entity_id),
		meta: JSON.parse(r.meta_json as string) as AuditMeta,
		createdAt: r.created_at,
		user: userMap.get(userId) ?? { id: userId, email: '', displayName: '' }
	};
}

export function getAuditLogById(id: number): AuditLogEntry | null {
	const rows = kit
		.selectFrom(kitAuditLogs)
		.where(kitEq(kitAuditLogs.id, toBigInt(id)))
		.executeSync();
	const row = rows[0];
	if (!row) return null;
	const userMap = hydrateUsers([idFromBigInt(row.user_id)]);
	return toAuditLogEntry(row, userMap);
}

export function listAuditLogs(filters: AuditFilters = {}): AuditListResult {
	const limit = filters.limit ?? 100;
	const offset = filters.offset ?? 0;
	const search = filters.search?.trim().toLowerCase();

	const conditions = buildKitConditions(filters);
	const where = conditions.length ? kitAnd(...conditions) : undefined;

	if (!search) {
		let rowsQuery = kit
			.selectFrom(kitAuditLogs)
			.orderBy(kitDesc(kitAuditLogs.created_at), kitDesc(kitAuditLogs.id))
			.limit(limit)
			.offset(offset);
		if (where) {
			rowsQuery = rowsQuery.where(where);
		}
		const rows = rowsQuery.executeSync();

		let countQuery = kit.selectFrom(kitAuditLogs).selectCount();
		if (where) {
			countQuery = countQuery.where(where);
		}
		const total = Number(countQuery.executeSync());

		const userIds = rows.map((r) => idFromBigInt(r.user_id));
		const userMap = hydrateUsers(userIds);
		const logs = rows.map((r) => toAuditLogEntry(r, userMap));
		return { logs, total };
	}

	let rowsQuery = kit
		.selectFrom(kitAuditLogs)
		.orderBy(kitDesc(kitAuditLogs.created_at), kitDesc(kitAuditLogs.id));
	if (where) {
		rowsQuery = rowsQuery.where(where);
	}
	// ponytail: bounded in-memory search; move search into DB if audit logs need deeper full-text lookup.
	const rows = rowsQuery.limit(AUDIT_SEARCH_SCAN_LIMIT).executeSync();

	const userIds = rows.map((r) => idFromBigInt(r.user_id));
	const userMap = hydrateUsers(userIds);

	let logs = rows.map((r) => toAuditLogEntry(r, userMap));
	logs = logs.filter((l) => {
		const haystack = [l.action, l.entityType, l.user.email, l.user.displayName, JSON.stringify(l.meta)]
			.join(' ')
			.toLowerCase();
		return haystack.includes(search);
	});

	const total = logs.length;
	return { logs: logs.slice(offset, offset + limit), total };
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
