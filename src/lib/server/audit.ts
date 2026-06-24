import { db } from './db';
import { auditLogs } from './db/schema';

export interface AuditMeta {
	[key: string]: unknown;
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
