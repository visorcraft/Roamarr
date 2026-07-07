import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { makeAdmin, makeSchedulerRun, makeUser } from '../../../../tests/helpers';

function makeEvent(url: string, user: unknown) {
	return {
		url: new URL(url, 'http://localhost'),
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('returns paginated scheduler runs', async () => {
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
		id: run1.id,
		startedAt: run1.startedAt,
		finishedAt: run1.finishedAt,
		success: true,
		errorMessage: null
	});
	expect(body.rows[1]).toMatchObject({
		id: run2.id,
		startedAt: run2.startedAt,
		finishedAt: run2.finishedAt,
		success: false,
		errorMessage: 'boom'
	});
});

test('rejects unauthenticated requests', async () => {
	await expect(GET(makeEvent('/api/jobs', null))).rejects.toMatchObject({ status: 401 });
});

test('rejects non-admin users', async () => {
	const user = makeUser(ctx.kit);
	await expect(GET(makeEvent('/api/jobs', user))).rejects.toMatchObject({ status: 403 });
});
