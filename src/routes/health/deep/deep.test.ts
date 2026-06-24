import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

vi.mock('$lib/server/scheduler', () => ({ isSchedulerRunning: vi.fn() }));

import { GET } from './+server';
import { isSchedulerRunning } from '$lib/server/scheduler';

test('deep health returns 200 when db and scheduler are healthy', () => {
	(isSchedulerRunning as any).mockReturnValue(true);
	const res = GET({} as any) as Response;
	expect(res.status).toBe(200);
});

test('deep health returns 503 when scheduler is not running', () => {
	(isSchedulerRunning as any).mockReturnValue(false);
	const res = GET({} as any) as Response;
	expect(res.status).toBe(503);
});
