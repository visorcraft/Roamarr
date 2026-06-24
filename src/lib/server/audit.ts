import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from './db';
import { auditLogs, users } from './db/schema';

export interface AuditMeta {
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

export function logAudit(
	userId: number,
	action: string,
	entityType: string,
	entityId: number,
	meta: AuditMeta = {}
) {
	db.insert(auditLogs).values({
		userId,
		action,
		entityType,
		entityId,
		metaJson: JSON.stringify(meta)
	}).run();
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

export function listAuditLogs(filters: AuditFilters = {}): AuditListResult {
	const conditions = [];
	if (filters.userId != null) conditions.push(eq(auditLogs.userId, filters.userId));
	if (filters.action) conditions.push(eq(auditLogs.action, filters.action));
	if (filters.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType));
	if (filters.from) conditions.push(gte(auditLogs.createdAt, filters.from));
	if (filters.to) conditions.push(lte(auditLogs.createdAt, filters.to));

	const where = conditions.length ? and(...conditions) : undefined;

	const totalRow = db
		.select({ count: sql<number>`count(*)` })
		.from(auditLogs)
		.where(where)
		.get();
	const total = totalRow?.count ?? 0;

	const rows = db
		.select({
			id: auditLogs.id,
			action: auditLogs.action,
			entityType: auditLogs.entityType,
			entityId: auditLogs.entityId,
			metaJson: auditLogs.metaJson,
			createdAt: auditLogs.createdAt,
			userId: users.id,
			userEmail: users.email,
			userDisplayName: users.displayName
		})
		.from(auditLogs)
		.innerJoin(users, eq(auditLogs.userId, users.id))
		.where(where)
		.orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
		.limit(filters.limit ?? 100)
		.offset(filters.offset ?? 0)
		.all();

	const logs = rows.map((r) => ({
		id: r.id,
		action: r.action,
		entityType: r.entityType,
		entityId: r.entityId,
		meta: JSON.parse(r.metaJson) as AuditMeta,
		createdAt: r.createdAt,
		user: {
			id: r.userId,
			email: r.userEmail,
			displayName: r.userDisplayName
		}
	}));
	return { logs, total };
}
