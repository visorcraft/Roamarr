import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { makeAdmin, makeUser } from '../../../../tests/helpers';
import { logAudit } from '$lib/server/repositories/auditRepo';
import { resetRateLimit } from '$lib/server/rateLimit';
import { auditLogs, users } from '$lib/server/db/mongrelSchema';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function makeEvent(url: string, user: unknown) {
	return {
		url: new URL(url, 'http://localhost'),
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

function insertLog(userId: number, action: string, entityType: string, entityId: number, createdAt: string) {
	return kitDb()
		.insertInto(auditLogs)
		.values({
			user_id: BigInt(userId),
			action,
			entity_type: entityType,
			entity_id: BigInt(entityId),
			meta_json: '{}',
			created_at: createdAt
		} as any)
		.executeSync();
}

beforeEach(() => {
	resetRateLimit();
	const kit = kitDb();
	kit.deleteFrom(auditLogs).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('returns paginated audit logs with nested user', async () => {
	const admin = makeAdmin(ctx.kit);
	const user = makeUser(ctx.kit, { email: 'actor@example.com' });
	logAudit(user.id, 'login', 'session', user.id, { ip: '1.2.3.4' });

	const res = await GET(makeEvent('/api/audit-logs', admin));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(1);
	expect(body.rows).toHaveLength(1);
	expect(body.rows[0]).toMatchObject({
		action: 'login',
		entityType: 'session',
		entityId: user.id,
		user: {
			id: user.id,
			email: 'actor@example.com'
		}
	});
	expect(body.rows[0].createdAt).toBeDefined();
});

test('rejects unauthenticated requests', async () => {
	await expect(GET(makeEvent('/api/audit-logs', null))).rejects.toMatchObject({ status: 401 });
});

test('rejects non-admin users', async () => {
	const user = makeUser(ctx.kit);
	await expect(GET(makeEvent('/api/audit-logs', user))).rejects.toMatchObject({ status: 403 });
});

test('rejects invalid from date', async () => {
	const admin = makeAdmin(ctx.kit);
	await expect(GET(makeEvent('/api/audit-logs?from=not-a-date', admin))).rejects.toMatchObject({
		status: 400
	});
});

test('rejects invalid to date', async () => {
	const admin = makeAdmin(ctx.kit);
	await expect(GET(makeEvent('/api/audit-logs?to=bad', admin))).rejects.toMatchObject({ status: 400 });
});

test('rate limits repeated requests', async () => {
	const admin = makeAdmin(ctx.kit);
	for (let i = 0; i < 10; i++) {
		const res = await GET(makeEvent('/api/audit-logs', admin));
		expect(res.status).toBe(200);
	}
	await expect(GET(makeEvent('/api/audit-logs', admin))).rejects.toMatchObject({ status: 429 });
});

test('to date filter is inclusive of events on that day', async () => {
	const admin = makeAdmin(ctx.kit);
	insertLog(admin.id, 'login', 'session', 1, '2026-06-15T12:00:00.000Z');

	const res = await GET(makeEvent('/api/audit-logs?to=2026-06-15', admin));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(1);
	expect(body.rows[0].action).toBe('login');
});

test('from date filter is inclusive of events on that day', async () => {
	const admin = makeAdmin(ctx.kit);
	insertLog(admin.id, 'login', 'session', 1, '2026-06-15T12:00:00.000Z');

	const res = await GET(makeEvent('/api/audit-logs?from=2026-06-15', admin));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(1);
	expect(body.rows[0].action).toBe('login');
});

test('date filters exclude events outside the range', async () => {
	const admin = makeAdmin(ctx.kit);
	insertLog(admin.id, 'early', 'session', 1, '2026-06-14T23:59:59.999Z');
	insertLog(admin.id, 'mid', 'session', 2, '2026-06-15T12:00:00.000Z');
	insertLog(admin.id, 'late', 'session', 3, '2026-06-16T00:00:00.000Z');

	const res = await GET(makeEvent('/api/audit-logs?from=2026-06-15&to=2026-06-15', admin));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(1);
	expect(body.rows[0].action).toBe('mid');
});

test('ignores invalid sort keys', async () => {
	const admin = makeAdmin(ctx.kit);
	const res = await GET(makeEvent('/api/audit-logs?sort=invalidColumn&dir=desc', admin));
	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body.rows).toHaveLength(0);
});
