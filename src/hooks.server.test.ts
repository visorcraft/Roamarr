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

function parseCsp(header: string | null) {
	const map = new Map<string, string[]>();
	if (!header) return map;
	for (const part of header.split(';')) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const [key, ...values] = trimmed.split(/\s+/);
		map.set(key, values);
	}
	return map;
}

test('sets baseline security and CSP headers on a public response', async () => {
	(ctx as any).db.update(settings).set({ setupComplete: true }).where(eq(settings.id, 1)).run();
	const res = (await run('/login')) as Response;
	expect(res.status).toBe(200);
	expect(res.headers.get('X-Frame-Options')).toBe('DENY');
	expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
	expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');

	const csp = res.headers.get('Content-Security-Policy');
	expect(csp).toBeTruthy();
	const parsed = parseCsp(csp);
	expect(parsed.get('default-src')).toContain("'self'");
	expect(parsed.get('script-src')).toEqual(["'self'", "'unsafe-inline'"]);
	expect(parsed.get('style-src')).toContain("'unsafe-inline'");
	expect(parsed.get('style-src')).toContain('https://fonts.googleapis.com');
	expect(parsed.get('font-src')).toContain('https://fonts.gstatic.com');
	expect(parsed.get('frame-ancestors')).toEqual(["'none'"]);
	expect(parsed.get('object-src')).toEqual(["'none'"]);
});

test('sets CSP headers on a public share link', async () => {
	(ctx as any).db.update(settings).set({ setupComplete: true }).where(eq(settings.id, 1)).run();
	const res = (await run('/share/abc123')) as Response;
	expect(res.status).toBe(200);
	expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
});
