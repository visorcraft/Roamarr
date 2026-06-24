import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';

function event() {
	return { request: new Request('http://localhost/health') } as any;
}

test('health returns ok when db and scheduler are healthy', async () => {
	(globalThis as { __roamarr_scheduler?: boolean }).__roamarr_scheduler = true;
	const res = await GET(event());
	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body).toEqual({ ok: true, db: true, scheduler: true });
	delete (globalThis as { __roamarr_scheduler?: boolean }).__roamarr_scheduler;
});

test('health reports scheduler false when scheduler is not running', async () => {
	delete (globalThis as { __roamarr_scheduler?: boolean }).__roamarr_scheduler;
	const res = await GET(event());
	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body).toEqual({ ok: false, db: true, scheduler: false });
});

test('health does not leak sensitive data', async () => {
	(globalThis as { __roamarr_scheduler?: boolean }).__roamarr_scheduler = true;
	const res = await GET(event());
	const text = await res.text();
	expect(text).not.toContain('roamarr.db');
	expect(text).not.toContain('secret');
	expect(text).toMatch(/^\{["']ok["']/);
	delete (globalThis as { __roamarr_scheduler?: boolean }).__roamarr_scheduler;
});
