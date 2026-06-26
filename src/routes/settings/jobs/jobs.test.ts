import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import { schedulerRuns, users } from '$lib/server/db/schema';
import { sql } from 'drizzle-orm';
import { beforeEach } from 'vitest';
import { makeAdminLocals, makeUserLocals } from '../../../../tests/eventHelpers';

beforeEach(() => {
	(ctx as any).sqlite.exec('delete from users; delete from scheduler_runs;');
});

test('load rejects non-admin', () => {
	const u = makeUserLocals((ctx as any).db);
	try {
		load({ locals: u } as any);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(403);
	}
});

test('load returns recent scheduler runs newest first', () => {
	const db = (ctx as any).db;
	const admin = makeAdminLocals((ctx as any).db);
	db.insert(schedulerRuns)
		.values([
			{
				startedAt: '2026-06-01T10:00:00.000Z',
				finishedAt: '2026-06-01T10:00:01.000Z',
				success: true
			},
			{
				startedAt: '2026-06-01T11:00:00.000Z',
				finishedAt: '2026-06-01T11:00:01.000Z',
				success: false,
				errorMessage: 'boom'
			}
		])
		.run();

	const result = load({ locals: admin } as any) as {
		runs: Array<{ success: boolean; errorMessage: string | null; startedAt: string }>;
	};
	expect(result.runs).toHaveLength(2);
	expect(result.runs[0].success).toBe(false);
	expect(result.runs[0].errorMessage).toBe('boom');
	expect(result.runs[1].success).toBe(true);
});

test('load limits to 50 runs', () => {
	const db = (ctx as any).db;
	const admin = makeAdminLocals((ctx as any).db);
	const base = new Date('2026-06-01T00:00:00.000Z').getTime();
	const values = Array.from({ length: 55 }, (_, i) => ({
		startedAt: new Date(base + i * 1000).toISOString(),
		finishedAt: new Date(base + i * 1000 + 1).toISOString(),
		success: true
	}));
	db.insert(schedulerRuns).values(values).run();

	const result = load({ locals: admin } as any) as { runs: unknown[] };
	expect(result.runs).toHaveLength(50);
});


test('runNow action triggers a scheduler tick and redirects', async () => {
	const db = (ctx as any).db;
	const admin = makeAdminLocals((ctx as any).db);
	const before = db.select({ count: sql`count(*)` }).from(schedulerRuns).get().count as number;
	await expect(actions.runNow({ locals: admin } as any)).rejects.toMatchObject({
		status: 303,
		location: '/settings/jobs'
	});
	const after = db.select({ count: sql`count(*)` }).from(schedulerRuns).get().count as number;
	expect(after).toBeGreaterThan(before);
});
