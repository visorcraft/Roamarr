import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./lib/server/db', async () => {
	const { freshDb } = await import('../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { handle } from './hooks.server';
import { settings } from './lib/server/db/schema';
import { eq } from 'drizzle-orm';

const ev = (path: string) => ({
	url: new URL('http://x' + path),
	cookies: { get: () => undefined },
	locals: {} as App.Locals,
	request: new Request('http://x' + path)
});

async function run(path: string) {
	return (handle({ event: ev(path) as any, resolve: async () => new Response('ok') }) as Promise<
		Response
	>).catch((e: any) => e);
}

test('redirects to /setup before setup is complete', async () => {
	const res: any = await run('/');
	expect(res.status).toBe(302);
	expect(res.location).toBe('/setup');
});

test('anonymous hitting a protected route is redirected to /login', async () => {
	(ctx as any).db.update(settings).set({ setupComplete: true }).where(eq(settings.id, 1)).run();
	const res: any = await run('/trips');
	expect(res.status).toBe(302);
	expect(res.location).toBe('/login');
});
