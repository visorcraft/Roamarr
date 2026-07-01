import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { logAudit, listAuditLogs, exportAuditLogsCsv } from './audit';
import { users, auditLogs } from './db/mongrelSchema';
import { eq, type KitDatabase } from '@visorcraft/mongreldb-kit';
import * as usersRepo from './repositories/usersRepo';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function makeUser(email: string, displayName: string) {
	return usersRepo.createUser({
		email,
		password_hash: 'x',
		display_name: displayName,
		calendar_token: null,
		calendar_token_expires_at: null
	});
}

beforeEach(() => {
	const kit = kitDb();
	kit.deleteFrom(auditLogs).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('logAudit writes a row with serialized metadata', () => {
	const kit = kitDb();
	const u = makeUser('audit@x.c', 'A');

	logAudit(Number(u.id), 'test_action', 'trip', 42, { reason: 'because' });

	const row = kit.selectFrom(auditLogs).executeSync()[0]!;
	expect(Number(row.user_id)).toBe(Number(u.id));
	expect(row.action).toBe('test_action');
	expect(row.entity_type).toBe('trip');
	expect(Number(row.entity_id)).toBe(42);
	expect(JSON.parse(row.meta_json as string)).toEqual({ reason: 'because' });
	expect(row.created_at).toBeDefined();
});

test('logAudit defaults meta to empty object', () => {
	const kit = kitDb();
	const u = makeUser('audit2@x.c', 'B');

	logAudit(Number(u.id), 'plain', 'settings', 1);

	const row = kit.selectFrom(auditLogs).where(eq(auditLogs.user_id, BigInt(u.id))).executeSync()[0]!;
	expect(JSON.parse(row.meta_json as string)).toEqual({});
});

test('listAuditLogs returns recent logs with user details in descending order', () => {
	const a = makeUser('a@x.c', 'Alice');
	const b = makeUser('b@x.c', 'Bob');

	logAudit(Number(a.id), 'trip_delete', 'trip', 1, { name: 'Old' });
	logAudit(Number(b.id), 'settings_update', 'settings', 1, { changed: ['instanceName'] });

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
	const u = makeUser('limit@x.c', 'L');

	for (let i = 0; i < 5; i++) {
		logAudit(Number(u.id), 'action', 'trip', i);
	}

	expect(listAuditLogs({ limit: 2 }).logs).toHaveLength(2);
	expect(listAuditLogs({ limit: 100 }).logs).toHaveLength(5);
});

test('listAuditLogs never exposes passwordHash', () => {
	const u = makeUser('safe@x.c', 'S');
	logAudit(Number(u.id), 'plain', 'settings', 1);

	const { logs } = listAuditLogs({ limit: 1 });
	expect(logs[0].user).not.toHaveProperty('passwordHash');
	expect(Object.keys(logs[0].user).sort()).toEqual(['displayName', 'email', 'id']);
});

test('exportAuditLogsCsv returns header and rows', () => {
	const u = makeUser('csv@x.c', 'CSV');
	logAudit(Number(u.id), 'csv_action', 'trip', 7, { note: 'hello' });

	const csv = exportAuditLogsCsv();
	const lines = csv.trim().split('\n');
	expect(lines[0]).toContain('id,action,entityType,entityId,userId,userEmail,userDisplayName,createdAt,meta');
	expect(lines[1]).toContain('csv_action');
	expect(lines[1]).toContain('csv@x.c');
	expect(lines[1]).toContain('CSV');
});
