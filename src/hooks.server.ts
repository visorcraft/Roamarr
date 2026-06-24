import { redirect, type Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { validateSession } from '$lib/server/auth';
import { isSetupComplete } from '$lib/server/settings';
import { bootApp } from '$lib/server/boot';

// Run one-time boot (secret guard → migrations → settings row → scheduler) at process
// start: adapter-node imports this module on `node build`, so a missing ROAMARR_SECRET
// or a failed migration fails the container now rather than on the first HTTP request.
// Idempotent; safe under Vite HMR (the `booted` flag short-circuits re-runs) and build
// (vite bundles without executing, and there are no prerender entries that would).
bootApp();

const PUBLIC = [/^\/setup/, /^\/login/, /^\/register/, /^\/share\//, /^\/trips\/\d+\/calendar\/feed$/, /^\/health$/];

const CSP_DIRECTIVES: Record<string, string[]> = {
	'default-src': ["'self'"],
	'script-src': ["'self'", "'unsafe-inline'"],
	'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
	'font-src': ["'self'", 'https://fonts.gstatic.com'],
	'img-src': ["'self'", 'data:'],
	'connect-src': dev ? ["'self'", 'ws:', 'wss:'] : ["'self'"],
	'form-action': ["'self'"],
	'base-uri': ["'self'"],
	'frame-ancestors': ["'none'"],
	'object-src': ["'none'"]
};

function contentSecurityPolicy() {
	return Object.entries(CSP_DIRECTIVES)
		.map(([directive, values]) => `${directive} ${values.join(' ')}`)
		.join('; ');
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = await validateSession(event.cookies.get('session'));
	const path = event.url.pathname;

	if (!isSetupComplete() && path !== '/setup' && path !== '/health') throw redirect(302, '/setup');
	if (isSetupComplete() && path === '/setup') throw redirect(302, '/login');

	const isPublic = PUBLIC.some((re) => re.test(path));
	if (!isPublic && !event.locals.user && isSetupComplete()) throw redirect(302, '/login');

	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Content-Security-Policy', contentSecurityPolicy());
	return response;
};
