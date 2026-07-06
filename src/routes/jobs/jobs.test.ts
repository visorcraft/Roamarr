import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import { schedulerRuns, users } from '$lib/server/db/mongrelSchema';

import { beforeEach } from 'vitest';
import { makeAdminLocals, makeUserLocals } from '../../../tests/eventHelpers';
import { makeSchedulerRun } from '../../../tests/helpers';

beforeEach(() => {
	(ctx as any).kit.deleteFrom(schedulerRuns).executeSync();
	(ctx as any).kit.deleteFrom(users).executeSync();
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

test('load returns recent scheduler runs newest first', () => {
	const kit = (ctx as any).kit;
	const admin = makeAdminLocals(kit);
	makeSchedulerRun(kit, {
		startedAt: '2026-06-01T10:00:00.000Z',
		finishedAt: '2026-06-01T10:00:01.000Z',
		success: true
	});
	makeSchedulerRun(kit, {
		startedAt: '2026-06-01T11:00:00.000Z',
		finishedAt: '2026-06-01T11:00:01.000Z',
		success: false,
		errorMessage: 'boom'
	});

	const result = load({ locals: admin } as any) as {
		runs: Array<{ success: boolean; errorMessage: string | null; startedAt: string }>;
	};
	expect(result.runs).toHaveLength(2);
	expect(result.runs[0].success).toBe(false);
	expect(result.runs[0].errorMessage).toBe('boom');
	expect(result.runs[1].success).toBe(true);
});

test('load limits to 50 runs', () => {
	const kit = (ctx as any).kit;
	const admin = makeAdminLocals(kit);
	const base = new Date('2026-06-01T00:00:00.000Z').getTime();
	for (let i = 0; i < 55; i++) {
		makeSchedulerRun(kit, {
			startedAt: new Date(base + i * 1000).toISOString(),
			finishedAt: new Date(base + i * 1000 + 1).toISOString(),
			success: true
		});
	}

	const result = load({ locals: admin } as any) as { runs: unknown[] };
	expect(result.runs).toHaveLength(50);
});

test('runNow action triggers a scheduler tick and redirects', async () => {
	const kit = (ctx as any).kit;
	const admin = makeAdminLocals(kit);
	const before = kit.selectFrom(schedulerRuns).selectCount().executeSync();
	await expect(actions.runNow({ locals: admin } as any)).rejects.toMatchObject({
		status: 303,
		location: '/jobs'
	});
	const after = kit.selectFrom(schedulerRuns).selectCount().executeSync();
	expect(after).toBeGreaterThan(before);
});
