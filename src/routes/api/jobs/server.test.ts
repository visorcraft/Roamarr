import { test, expect, vi, beforeEach } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import {
	makeAdmin,
	makeSchedulerRun,
	makeUser
} from '../../../../tests/helpers';
import { schedulerRuns } from '$lib/server/db/mongrelSchema';

function makeEvent(url: string, user: unknown) {
	return {
		url: new URL(url, 'http://localhost'),
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

beforeEach(() => {
	(ctx.kit as KitDatabase).deleteFrom(schedulerRuns).executeSync();
});

test('returns paginated scheduler runs newest first by default', async () => {
	const admin = makeAdmin(ctx.kit);
	const run1 = makeSchedulerRun(ctx.kit, {
		success: true,
		startedAt: '2024-01-01T00:00:00Z'
	});
	const run2 = makeSchedulerRun(ctx.kit, {
		success: false,
		errorMessage: 'boom',
		startedAt: '2024-01-02T00:00:00Z'
	});

	const res = await GET(makeEvent('/api/jobs', admin));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(2);
	expect(body.rows).toHaveLength(2);
	expect(body.rows[0]).toMatchObject({
		id: run2.id,
		startedAt: run2.startedAt,
		finishedAt: run2.finishedAt,
		success: false,
		errorMessage: 'boom'
	});
	expect(body.rows[1]).toMatchObject({
		id: run1.id,
		startedAt: run1.startedAt,
		finishedAt: run1.finishedAt,
		success: true,
		errorMessage: null
	});
});

test('limit parameter limits the number of rows', async () => {
	const admin = makeAdmin(ctx.kit);
	const run1 = makeSchedulerRun(ctx.kit, { startedAt: '2024-01-01T00:00:00Z' });
	const run2 = makeSchedulerRun(ctx.kit, { startedAt: '2024-01-02T00:00:00Z' });
	const run3 = makeSchedulerRun(ctx.kit, { startedAt: '2024-01-03T00:00:00Z' });

	const res = await GET(makeEvent('/api/jobs?limit=2', admin));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(3);
	expect(body.rows).toHaveLength(2);
	expect(body.rows[0].id).toBe(run3.id);
	expect(body.rows[1].id).toBe(run2.id);
});

test('search filters scheduler runs', async () => {
	const admin = makeAdmin(ctx.kit);
	makeSchedulerRun(ctx.kit, {
		success: true,
		startedAt: '2024-01-01T00:00:00Z'
	});
	makeSchedulerRun(ctx.kit, {
		success: false,
		errorMessage: 'timeout',
		startedAt: '2024-01-02T00:00:00Z'
	});
	const run3 = makeSchedulerRun(ctx.kit, {
		success: false,
		errorMessage: 'boom',
		startedAt: '2024-01-03T00:00:00Z'
	});

	const res = await GET(makeEvent('/api/jobs?search=boom', admin));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(1);
	expect(body.rows).toHaveLength(1);
	expect(body.rows[0]).toMatchObject({
		id: run3.id,
		success: false,
		errorMessage: 'boom'
	});
});

test('date filters scheduler runs by started date', async () => {
	const admin = makeAdmin(ctx.kit);
	makeSchedulerRun(ctx.kit, {
		startedAt: '2024-01-01T12:00:00Z'
	});
	const run2 = makeSchedulerRun(ctx.kit, {
		startedAt: '2024-02-01T12:00:00Z'
	});

	const res = await GET(makeEvent('/api/jobs?from=2024-02-01&to=2024-02-01', admin));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(1);
	expect(body.rows).toHaveLength(1);
	expect(body.rows[0].id).toBe(run2.id);
});

test('explicit asc sort returns oldest first', async () => {
	const admin = makeAdmin(ctx.kit);
	const run1 = makeSchedulerRun(ctx.kit, {
		success: true,
		startedAt: '2024-01-01T00:00:00Z'
	});
	const run2 = makeSchedulerRun(ctx.kit, {
		success: false,
		errorMessage: 'boom',
		startedAt: '2024-01-02T00:00:00Z'
	});

	const res = await GET(makeEvent('/api/jobs?sort=startedAt&dir=asc', admin));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(2);
	expect(body.rows[0].id).toBe(run1.id);
	expect(body.rows[1].id).toBe(run2.id);
});

test('rejects unauthenticated requests', async () => {
	await expect(GET(makeEvent('/api/jobs', null))).rejects.toMatchObject({ status: 401 });
});

test('rejects non-admin users', async () => {
	const user = makeUser(ctx.kit);
	await expect(GET(makeEvent('/api/jobs', user))).rejects.toMatchObject({ status: 403 });
});
