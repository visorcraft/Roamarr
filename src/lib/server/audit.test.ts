import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { logAudit, listAuditLogs, exportAuditLogsCsv } from './audit';
import { users, auditLogs } from './db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach } from 'vitest';

beforeEach(() => {
	(ctx as any).sqlite.exec('delete from audit_logs;');
	(ctx as any).sqlite.exec('delete from users;');
});

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


test('listAuditLogs returns recent logs with user details in descending order', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const a = db.insert(users).values({ email: 'a@x.c', passwordHash: 'x', displayName: 'Alice' }).returning().get();
	const b = db.insert(users).values({ email: 'b@x.c', passwordHash: 'x', displayName: 'Bob' }).returning().get();

	logAudit(a.id, 'trip_delete', 'trip', 1, { name: 'Old' });
	logAudit(b.id, 'settings_update', 'settings', 1, { changed: ['instanceName'] });

	const { logs } = listAuditLogs({ limit: 10 });
	expect(logs).toHaveLength(2);
	expect(logs[0].action).toBe('settings_update');
	expect(logs[0].user.email).toBe('b@x.c');
	expect(logs[0].user.displayName).toBe('Bob');
	expect(logs[0].meta).toEqual({ changed: ['instanceName'] });
	expect(logs[1].action).toBe('trip_delete');
	expect(logs[1].user.email).toBe('a@x.c');
});

test('listAuditLogs respects the limit', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'limit@x.c', passwordHash: 'x', displayName: 'L' }).returning().get();

	for (let i = 0; i < 5; i++) {
		logAudit(u.id, 'action', 'trip', i);
	}

	expect(listAuditLogs({ limit: 2 }).logs).toHaveLength(2);
	expect(listAuditLogs({ limit: 100 }).logs).toHaveLength(5);
});

test('listAuditLogs never exposes passwordHash', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'safe@x.c', passwordHash: 'secret-hash', displayName: 'S' }).returning().get();
	logAudit(u.id, 'plain', 'settings', 1);

	const { logs } = listAuditLogs({ limit: 1 });
	expect(logs[0].user).not.toHaveProperty('passwordHash');
	expect(Object.keys(logs[0].user).sort()).toEqual(['displayName', 'email', 'id']);
});

test('exportAuditLogsCsv returns header and rows', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'csv@x.c', passwordHash: 'x', displayName: 'CSV' }).returning().get();
	logAudit(u.id, 'csv_action', 'trip', 7, { note: 'hello' });

	const csv = exportAuditLogsCsv();
	const lines = csv.trim().split('\n');
	expect(lines[0]).toContain('id,action,entityType,entityId,userId,userEmail,userDisplayName,createdAt,meta');
	expect(lines[1]).toContain('csv_action');
	expect(lines[1]).toContain('csv@x.c');
	expect(lines[1]).toContain('CSV');
});
