import { desc, eq } from 'drizzle-orm';
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

export function listAuditLogs(limit = 100): AuditLogEntry[] {
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
		.orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
		.limit(limit)
		.all();

	return rows.map((r) => ({
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
}
