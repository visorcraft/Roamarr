import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load } from './+page.server';
import { schedulerRuns, users } from '$lib/server/db/schema';
import { beforeEach } from 'vitest';

beforeEach(() => {
	(ctx as any).sqlite.exec('delete from users; delete from scheduler_runs;');
});

function adminLocals() {
	const u = (ctx as any).db
		.insert(users)
		.values({ email: 'admin@x.c', passwordHash: 'x', displayName: 'Admin', role: 'admin' })
		.returning()
		.get();
	return { user: u };
}

function userLocals() {
	const u = (ctx as any).db
		.insert(users)
		.values({ email: 'user@x.c', passwordHash: 'x', displayName: 'User', role: 'user' })
		.returning()
		.get();
	return { user: u };
}

test('load rejects non-admin', () => {
	const u = userLocals();
	try {
		load({ locals: u } as any);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(403);
	}
});

test('load returns recent scheduler runs newest first', () => {
	const db = (ctx as any).db;
	const admin = adminLocals();
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
	const admin = adminLocals();
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
