import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import { schedulerRuns, users, auditLogs } from '$lib/server/db/mongrelSchema';
import { resetRateLimit } from '$lib/server/rateLimit';

import { beforeEach } from 'vitest';
import { makeAdminLocals, makeUserLocals } from '../../../tests/eventHelpers';

const clientAddress = '127.0.0.1';

beforeEach(() => {
	(ctx as any).kit.deleteFrom(schedulerRuns).executeSync();
	(ctx as any).kit.deleteFrom(users).executeSync();
	(ctx as any).kit.deleteFrom(auditLogs).executeSync();
	resetRateLimit(clientAddress);
});

test('load rejects non-admin', () => {
	const u = makeUserLocals((ctx as any).kit);
	try {
		load({ locals: u } as any);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(403);
	}
});

test('load returns empty shape for admin', () => {
	const admin = makeAdminLocals((ctx as any).kit);
	const result = load({ locals: admin } as any);
	expect(result).toEqual({});
});

test('runNow action triggers a scheduler tick, logs audit, and redirects', async () => {
	const kit = (ctx as any).kit;
	const admin = makeAdminLocals(kit);
	const before = kit.selectFrom(schedulerRuns).selectCount().executeSync();
	await expect(
		actions.runNow({ locals: admin, getClientAddress: () => clientAddress } as any)
	).rejects.toMatchObject({
		status: 303,
		location: '/jobs'
	});
	const after = kit.selectFrom(schedulerRuns).selectCount().executeSync();
	expect(after).toBeGreaterThan(before);

	const logs = kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('scheduler_run_manual');
	expect(logs[0].entity_type).toBe('scheduler_run');
	expect(Number(logs[0].entity_id)).toBe(1);
	expect(Number(logs[0].user_id)).toBe(admin.user.id);
});

test('runNow action is rate limited', async () => {
	const kit = (ctx as any).kit;
	const admin = makeAdminLocals(kit);
	for (let i = 0; i < 10; i += 1) {
		try {
			await actions.runNow({ locals: admin, getClientAddress: () => clientAddress } as any);
		} catch (e: any) {
			expect(e.status).toBe(303);
		}
	}
	const result = await actions.runNow({
		locals: admin,
		getClientAddress: () => clientAddress
	} as any);
	expect(result).toMatchObject({ status: 429, data: { error: 'Too many attempts. Try again later.' } });
});
