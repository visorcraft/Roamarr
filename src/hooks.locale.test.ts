import { test, expect, vi } from 'vitest';

// Same environment as hooks.server.test.ts, plus a paraglideMiddleware stand-in that records the
// request it receives. Kept in its own file so the main hook tests use the real middleware.
const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./lib/server/db', async () => {
	const { freshDb } = await import('../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
vi.mock('./lib/server/boot', async () => ({
	bootApp: () => {},
	isMissingSecret: () => false,
	getBootError: () => undefined
}));
const seen = vi.hoisted(() => ({ request: undefined as Request | undefined }));
vi.mock('$lib/paraglide/server', () => ({
	paraglideMiddleware: (request: Request, cb: (args: { request: Request; locale: string }) => unknown) => {
		seen.request = request;
		return cb({ request, locale: 'en' });
	}
}));

import { handle, localizedResolve } from './hooks.server';

const chunk = (html: string) => ({ html, done: true });

test('localizedResolve fills <html lang> when no transformPageChunk is passed', async () => {
	let transform: ((c: { html: string; done: boolean }) => unknown) | undefined;
	const resolve = vi.fn(async (_ev: unknown, opts?: { transformPageChunk?: typeof transform }) => {
		transform = opts?.transformPageChunk;
		return new Response('ok');
	});
	await localizedResolve(resolve as any, 'de')({} as any);
	expect(await transform!(chunk('<html lang="%lang%"><body>x</body></html>'))).toBe(
		'<html lang="de"><body>x</body></html>'
	);
});

test('localizedResolve composes a transformPageChunk from the caller instead of replacing it', async () => {
	let transform: ((c: { html: string; done: boolean }) => unknown) | undefined;
	const resolve = vi.fn(async (_ev: unknown, opts?: { transformPageChunk?: typeof transform; preload?: unknown }) => {
		transform = opts?.transformPageChunk;
		expect(opts?.preload).toBe(preload); // other options are passed through untouched
		return new Response('ok');
	});
	const preload = () => true;
	const inner = vi.fn(async ({ html }: { html: string }) => html.replace('<body>', '<body data-inner="1">'));
	await localizedResolve(resolve as any, 'en')({} as any, { transformPageChunk: inner, preload } as any);
	const out = await transform!(chunk('<html lang="%lang%"><body>x</body></html>'));
	expect(inner).toHaveBeenCalledOnce();
	expect(out).toBe('<html lang="en"><body data-inner="1">x</body></html>');
});

test('localizedResolve falls back to the original chunk when the inner transform returns undefined', async () => {
	let transform: ((c: { html: string; done: boolean }) => unknown) | undefined;
	const resolve = vi.fn(async (_ev: unknown, opts?: { transformPageChunk?: typeof transform }) => {
		transform = opts?.transformPageChunk;
		return new Response('ok');
	});
	await localizedResolve(resolve as any, 'en')({} as any, { transformPageChunk: () => undefined } as any);
	expect(await transform!(chunk('<html lang="%lang%">'))).toBe('<html lang="en">');
});

test('the middleware gets a body-less copy that keeps URL, method and headers', async () => {
	const original = new Request('http://x/api/v1/backup/restore', {
		method: 'POST',
		headers: { 'accept-language': 'de-DE,de;q=0.9', 'content-type': 'application/octet-stream' },
		body: 'payload'
	});
	const event = { url: new URL(original.url), cookies: { get: () => undefined }, locals: {}, request: original };
	seen.request = undefined;
	// appHandle may answer with a redirect (setup not complete); only a thrown non-redirect is a failure.
	await (handle({ event: event as any, resolve: async () => new Response('ok') }) as Promise<Response>).catch((e: any) => {
		if (!(e?.status >= 300 && e?.status < 400)) throw e;
	});
	expect(seen.request, 'handle() never reached paraglideMiddleware').toBeDefined();
	const copy = seen.request!;
	expect(copy).not.toBe(original);
	expect(copy.url).toBe(original.url);
	expect(copy.method).toBe('POST');
	expect(copy.headers.get('accept-language')).toBe('de-DE,de;q=0.9');
	expect(copy.body).toBeNull();
	// The original body is untouched and still readable by the route.
	expect(original.bodyUsed).toBe(false);
	expect(await original.text()).toBe('payload');
});
