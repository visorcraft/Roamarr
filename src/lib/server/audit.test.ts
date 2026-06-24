import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { logAudit } from './audit';
import { users, auditLogs } from './db/schema';
import { eq } from 'drizzle-orm';

test('logAudit writes a row with serialized metadata', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'audit@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();

	logAudit(u.id, 'test_action', 'trip', 42, { reason: 'because' });

	const row = db.select().from(auditLogs).get()!;
	expect(row.userId).toBe(u.id);
	expect(row.action).toBe('test_action');
	expect(row.entityType).toBe('trip');
	expect(row.entityId).toBe(42);
	expect(JSON.parse(row.metaJson)).toEqual({ reason: 'because' });
	expect(row.createdAt).toBeDefined();
});

test('logAudit defaults meta to empty object', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'audit2@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();

	logAudit(u.id, 'plain', 'settings', 1);

	const row = db.select().from(auditLogs).where(eq(auditLogs.userId, u.id)).get()!;
	expect(JSON.parse(row.metaJson)).toEqual({});
});
