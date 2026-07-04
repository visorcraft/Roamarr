import { test, expect, vi, beforeEach } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';
import { checkRateLimit, resetRateLimit } from '$lib/server/rateLimit';

const ctx = vi.hoisted(() => ({ kit: null as never as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { auditLogs, users } from '$lib/server/db/mongrelSchema';

type MaintenanceAction = 'check' | 'gc' | 'flush' | 'doctor';

let userCounter = 0;

function kitDb(): KitDatabase {
	return ctx.kit;
}

function makeLocals(role: 'admin' | 'user') {
	const n = userCounter++;
	const u = usersRepo.createUser({
		email: `${role}-${n}@x.c`,
		password_hash: 'x',
		display_name: role === 'admin' ? 'Admin' : 'User',
		calendar_token: null,
		calendar_token_expires_at: null,
		role
	} as any);
	return { user: { id: Number(u.id), role } };
}

function makeRequest(action: MaintenanceAction, confirm = false) {
	const form = new FormData();
	if (confirm) form.set('confirmMaintenance', action);
	return new Request('http://localhost/settings/maintenance', { method: 'POST', body: form });
}

function makeEvent(
	action: MaintenanceAction,
	confirm = false,
	role: 'admin' | 'user' = 'admin',
	ip = '127.0.0.1'
) {
	return {
		locals: makeLocals(role),
		request: makeRequest(action, confirm),
		getClientAddress: () => ip
	} as any;
}

beforeEach(() => {
	resetRateLimit();
	kitDb().deleteFrom(auditLogs).executeSync();
	kitDb().deleteFrom(users).executeSync();
});

test('load requires admin', () => {
	try {
		load({ locals: makeLocals('user') } as any);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(403);
	}
	expect(load({ locals: makeLocals('admin') } as any)).toEqual({});
});

test('check action requires admin', async () => {
	await expect(actions.check(makeEvent('check', false, 'user'))).rejects.toMatchObject({
		status: 403
	});
});

test('check succeeds for admin', async () => {
	const result = (await actions.check(makeEvent('check'))) as any;
	expect(result.success).toBe(true);
	expect(result.action).toBe('check');
	expect(result.result.ok).toBe(true);
});

test('gc requires confirmation', async () => {
	const result = await actions.gc(makeEvent('gc', false));
	expect(result?.status).toBe(400);
	expect(result?.data?.action).toBe('gc');
});

test('gc succeeds when confirmed', async () => {
	const result = (await actions.gc(makeEvent('gc', true))) as any;
	expect(result.success).toBe(true);
	expect(result.result).toHaveProperty('compacted');
	expect(result.result).toHaveProperty('skipped');
});

test('flush requires confirmation', async () => {
	const result = await actions.flush(makeEvent('flush', false));
	expect(result?.status).toBe(400);
	expect(result?.data?.action).toBe('flush');
});

test('flush succeeds when confirmed', async () => {
	const result = (await actions.flush(makeEvent('flush', true))) as any;
	expect(result.success).toBe(true);
	expect(result.result.tableCount).toBeGreaterThan(0);
});

test('doctor requires confirmation', async () => {
	const result = await actions.doctor(makeEvent('doctor', false));
	expect(result?.status).toBe(400);
	expect(result?.data?.action).toBe('doctor');
});

test('doctor succeeds when confirmed', async () => {
	const result = (await actions.doctor(makeEvent('doctor', true))) as any;
	expect(result.success).toBe(true);
	expect(result.result.ok).toBe(true);
});

async function expectRateLimited(action: MaintenanceAction, maxAttempts: number) {
	const ip = `10.0.0.${maxAttempts}`;
	const route = `maintenance_${action}`;
	for (let i = 0; i < maxAttempts; i++) {
		checkRateLimit(ip, route, { maxAttempts, windowMs: 60_000 });
	}
	const actionFn = actions[action]!;
	const result = (await actionFn(makeEvent(action, action !== 'check', 'admin', ip))) as any;
	expect(result?.status).toBe(429);
	expect(result?.data?.retryAfter).toBeGreaterThan(0);
}

test('each maintenance action is rate limited', async () => {
	await expectRateLimited('check', 10);
	resetRateLimit();
	await expectRateLimited('gc', 5);
	resetRateLimit();
	await expectRateLimited('flush', 5);
	resetRateLimit();
	await expectRateLimited('doctor', 3);
});

test('rate limit buckets do not bleed between actions', async () => {
	const ip = '10.0.0.99';
	for (let i = 0; i < 10; i++) {
		checkRateLimit(ip, 'maintenance_check', { maxAttempts: 10, windowMs: 60_000 });
	}
	const result = (await actions.gc(makeEvent('gc', true, 'admin', ip))) as any;
	expect(result.success).toBe(true);
});

test('audit log entries are created', async () => {
	const before = countAuditLogs();
	await actions.check(makeEvent('check'));
	expect(countAuditLogs()).toBe(before + 1);
});

function countAuditLogs(): number {
	return Number(kitDb().selectFrom(auditLogs).selectCount().executeSync());
}
