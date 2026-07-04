import { test, expect, vi, beforeEach } from 'vitest';
import { eq, desc, type KitDatabase } from '@visorcraft/mongreldb-kit';
import { resetRateLimit } from '$lib/server/rateLimit';

const ctx = vi.hoisted(() => ({ kit: null as never as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import { makeUser, makeAdmin } from '../../../../tests/helpers';
import { auditLogs, users } from '$lib/server/db/mongrelSchema';

type MaintenanceAction = 'check' | 'gc' | 'flush' | 'doctor';

function kitDb(): KitDatabase {
	return ctx.kit;
}

function makeLocals(role: 'admin' | 'user') {
	const u = role === 'admin' ? makeAdmin(ctx.kit) : makeUser(ctx.kit);
	return { user: { id: u.id, role: u.role as 'admin' | 'user' } };
}

function makeRequest(action: MaintenanceAction, confirm = false) {
	const form = new FormData();
	if (confirm) form.set('confirmMaintenance', action);
	return new Request('http://localhost/settings/maintenance', { method: 'POST', body: form });
}

function makeEvent(
	action: MaintenanceAction,
	confirm = false,
	roleOrUser: 'admin' | 'user' | { id: number; role: 'admin' | 'user' } = 'admin',
	ip = '127.0.0.1'
) {
	const locals =
		typeof roleOrUser === 'string'
			? makeLocals(roleOrUser)
			: { user: { id: roleOrUser.id, role: roleOrUser.role } };
	return {
		locals,
		request: makeRequest(action, confirm),
		getClientAddress: () => ip
	} as any;
}

function latestAuditLogFor(userId: number) {
	return ctx.kit
		.selectFrom(auditLogs)
		.where(eq(auditLogs.user_id, BigInt(userId)))
		.orderBy(desc(auditLogs.created_at))
		.limit(1)
		.executeSync()[0];
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

test('load requires authentication', () => {
	try {
		load({ locals: {} } as any);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(401);
	}
});

test('check action requires admin', async () => {
	await expect(actions.check(makeEvent('check', false, 'user'))).rejects.toMatchObject({
		status: 403
	});
});

test('check action requires authentication', async () => {
	await expect(
		actions.check({
			request: makeRequest('check'),
			getClientAddress: () => '127.0.0.1',
			locals: {}
		} as any)
	).rejects.toMatchObject({ status: 401 });
});

for (const action of ['gc', 'flush', 'doctor'] as MaintenanceAction[]) {
	test(`${action} action requires admin`, async () => {
		const fn = actions[action] as (event: any) => Promise<unknown>;
		await expect(fn(makeEvent(action, true, 'user'))).rejects.toMatchObject({ status: 403 });
	});
}

for (const action of ['gc', 'flush', 'doctor'] as MaintenanceAction[]) {
	test(`${action} action requires authentication`, async () => {
		const fn = actions[action] as (event: any) => Promise<unknown>;
		await expect(
			fn({
				request: makeRequest(action, true),
				getClientAddress: () => '127.0.0.1',
				locals: {}
			} as any)
		).rejects.toMatchObject({ status: 401 });
	});
}

test('check succeeds for admin', async () => {
	const result = (await actions.check(makeEvent('check'))) as any;
	expect(result.success).toBe(true);
	expect(result.action).toBe('check');
	expect(result.result.ok).toBe(true);
});

for (const action of ['gc', 'flush', 'doctor'] as MaintenanceAction[]) {
	test(`${action} rejects missing confirmation`, async () => {
		const fn = actions[action] as (event: any) => Promise<unknown>;
		const result = (await fn(makeEvent(action, false))) as any;
		expect(result?.status).toBe(400);
		expect(result?.data?.action).toBe(action);
	});
}

for (const action of ['gc', 'flush', 'doctor'] as MaintenanceAction[]) {
	test(`${action} rejects mismatched confirmation`, async () => {
		const form = new FormData();
		form.set('confirmMaintenance', 'wrong-value');
		const fn = actions[action] as (event: any) => Promise<unknown>;
		const result = (await fn({
			locals: makeLocals('admin'),
			request: new Request('http://localhost/settings/maintenance', { method: 'POST', body: form }),
			getClientAddress: () => '127.0.0.1'
		} as any)) as any;
		expect(result.status).toBe(400);
		expect(result.data.action).toBe(action);
	});
}

test('gc succeeds when confirmed', async () => {
	const result = (await actions.gc(makeEvent('gc', true))) as any;
	expect(result.success).toBe(true);
	expect(result.result).toHaveProperty('compacted');
	expect(result.result).toHaveProperty('skipped');
});

test('flush succeeds when confirmed', async () => {
	const result = (await actions.flush(makeEvent('flush', true))) as any;
	expect(result.success).toBe(true);
	expect(result.result.tableCount).toBeGreaterThan(0);
});

test('doctor succeeds when confirmed', async () => {
	const result = (await actions.doctor(makeEvent('doctor', true))) as any;
	expect(result.success).toBe(true);
	expect(result.result.ok).toBe(true);
});

test('check returns fail when kit.check throws', async () => {
	const spy = vi.spyOn(ctx.kit, 'check').mockImplementation(() => {
		throw new Error('disk error');
	});
	const result = (await actions.check(makeEvent('check'))) as any;
	expect(result.status).toBe(400);
	expect(result.data.error).toBe('disk error');
	spy.mockRestore();
});

test('gc returns fail when kit.compactAll throws', async () => {
	const spy = vi.spyOn(ctx.kit, 'compactAll').mockImplementation(() => {
		throw new Error('gc error');
	});
	const result = (await actions.gc(makeEvent('gc', true))) as any;
	expect(result.status).toBe(400);
	expect(result.data.error).toBe('gc error');
	spy.mockRestore();
});

test('flush returns fail when kit.flush throws', async () => {
	const spy = vi.spyOn(ctx.kit, 'flush').mockImplementation(() => {
		throw new Error('flush error');
	});
	const result = (await actions.flush(makeEvent('flush', true))) as any;
	expect(result.status).toBe(400);
	expect(result.data.error).toBe('flush error');
	spy.mockRestore();
});

test('doctor returns fail when kit.doctor throws', async () => {
	const spy = vi.spyOn(ctx.kit, 'doctor').mockImplementation(() => {
		throw new Error('doctor error');
	});
	const result = (await actions.doctor(makeEvent('doctor', true))) as any;
	expect(result.status).toBe(400);
	expect(result.data.error).toBe('doctor error');
	spy.mockRestore();
});

async function expectRateLimited(action: MaintenanceAction, maxAttempts: number) {
	const ip = `10.0.0.${maxAttempts}`;
	const actionFn = actions[action] as (event: any) => Promise<unknown>;
	for (let i = 0; i < maxAttempts; i++) {
		const result = (await actionFn(makeEvent(action, action !== 'check', 'admin', ip))) as any;
		expect(result.success).toBe(true);
	}
	const result = (await actionFn(makeEvent(action, action !== 'check', 'admin', ip))) as any;
	expect(result.status).toBe(429);
	expect(result.data.retryAfter).toBeGreaterThan(0);
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
		const result = (await actions.check(makeEvent('check', false, 'admin', ip))) as any;
		expect(result.success).toBe(true);
	}
	const result = (await actions.gc(makeEvent('gc', true, 'admin', ip))) as any;
	expect(result.success).toBe(true);
});

test('audit log entries are created with correct fields', async () => {
	const admin = makeAdmin(ctx.kit);
	const result = (await actions.check(
		makeEvent('check', false, { id: admin.id, role: admin.role as 'admin' | 'user' })
	)) as any;
	const log = latestAuditLogFor(admin.id);
	expect(log).toBeDefined();
	expect(log.action).toBe('db_check');
	expect(log.user_id).toBe(BigInt(admin.id));
	expect(log.entity_type).toBe('settings');
	const meta = JSON.parse(log.meta_json as string);
	expect(meta.ok).toBe(true);
	expect(meta.tableCount).toBe(result.result.tableCount);
});

for (const action of ['gc', 'flush', 'doctor'] as MaintenanceAction[]) {
	test(`${action} audit log entry is created with correct fields`, async () => {
		const admin = makeAdmin(ctx.kit);
		const fn = actions[action] as (event: any) => Promise<unknown>;
		const result = (await fn(
			makeEvent(action, true, { id: admin.id, role: admin.role as 'admin' | 'user' })
		)) as any;
		const log = latestAuditLogFor(admin.id);
		expect(log).toBeDefined();
		expect(log.action).toBe(`db_${action}`);
		expect(log.user_id).toBe(BigInt(admin.id));
		expect(log.entity_type).toBe('settings');
		const meta = JSON.parse(log.meta_json as string);
		if (action === 'gc') {
			expect(meta.compacted).toBe(result.result.compacted);
			expect(meta.skipped).toBe(result.result.skipped);
		} else if (action === 'flush') {
			expect(meta.tableCount).toBe(result.result.tableCount);
		} else {
			expect(meta.ok).toBe(result.result.ok);
			expect(meta.quarantinedCount).toBe(result.result.quarantinedCount);
		}
	});
}
