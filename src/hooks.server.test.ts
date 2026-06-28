import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./lib/server/db', async () => {
	const { freshDb } = await import('../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { handle } from './hooks.server';
import { createSession, validateSession } from './lib/server/auth';
import { settings } from './lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { makeKitUser } from '../tests/kitHelpers';

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
	// MapLibre needs a blob worker and the configured tile origin (default: OpenStreetMap).
	expect(parsed.get('worker-src')).toContain('blob:');
	expect(parsed.get('img-src')).toContain('blob:');
	expect(parsed.get('connect-src')).toContain('https://tile.openstreetmap.org');
});

test('sets CSP headers on a public share link', async () => {
	(ctx as any).db.update(settings).set({ setupComplete: true }).where(eq(settings.id, 1)).run();
	const res = (await run('/share/abc123')) as Response;
	expect(res.status).toBe(200);
	expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
});

test('/health is public and not redirected before setup', async () => {
	const res = (await run('/health')) as Response;
	expect(res.status).toBe(200);
});

test('/health is public and not redirected after setup', async () => {
	(ctx as any).db.update(settings).set({ setupComplete: true }).where(eq(settings.id, 1)).run();
	const res = (await run('/health')) as Response;
	expect(res.status).toBe(200);
});

test('reads a flash cookie into locals and clears it', async () => {
	(ctx as any).db.update(settings).set({ setupComplete: true }).where(eq(settings.id, 1)).run();
	const cookies = {
		get: (name: string) => (name === 'flash' ? 'Saved.' : undefined),
		set: vi.fn()
	};
	const ev = (path: string) => ({
		url: new URL('http://x' + path),
		cookies,
		locals: {} as App.Locals,
		request: new Request('http://x' + path)
	});
	const res = (await handle({
		event: ev('/login') as any,
		resolve: async (e: any) => {
			expect(e.locals.flash).toBe('Saved.');
			return new Response('ok');
		}
	})) as Response;
	expect(res.status).toBe(200);
	expect(cookies.set).toHaveBeenCalledWith('flash', '', { path: '/', maxAge: 0 });
});

test('parses a JSON flash cookie with a variant', async () => {
	(ctx as any).db.update(settings).set({ setupComplete: true }).where(eq(settings.id, 1)).run();
	const flashPayload = JSON.stringify({ message: 'Failed.', variant: 'error' });
	const cookies = {
		get: (name: string) => (name === 'flash' ? flashPayload : undefined),
		set: vi.fn()
	};
	const ev = (path: string) => ({
		url: new URL('http://x' + path),
		cookies,
		locals: {} as App.Locals,
		request: new Request('http://x' + path)
	});
	const res = (await handle({
		event: ev('/login') as any,
		resolve: async (e: any) => {
			expect(e.locals.flash).toEqual({ message: 'Failed.', variant: 'error' });
			return new Response('ok');
		}
	})) as Response;
	expect(res.status).toBe(200);
	expect(cookies.set).toHaveBeenCalledWith('flash', '', { path: '/', maxAge: 0 });
});

test('redirects users who must reset password', async () => {
	const db = (ctx as any).db;
	db.update(settings).set({ setupComplete: true }).where(eq(settings.id, 1)).run();
	const u = makeKitUser({
		email: 'reset@x.c',
		password_hash: 'x',
		display_name: 'Reset',
		must_reset_password: true
	});
	expect(u.must_reset_password).toBe(true);
	const token = createSession(Number(u.id));
	expect(await validateSession(token)).toBeTruthy();
	const res: any = await Promise.resolve(
		handle({
			event: {
				url: new URL('http://x/trips'),
				cookies: { get: (name: string) => (name === 'session' ? token : undefined) },
				locals: {} as App.Locals,
				request: new Request('http://x/trips')
			} as any,
			resolve: async () => new Response('ok')
		})
	).catch((e: any) => e);
	expect(res.status).toBe(302);
	expect(res.location).toBe('/profile/change-password');
});
