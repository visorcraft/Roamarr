import { redirect, type Handle } from '@sveltejs/kit';
import { validateSession } from '$lib/server/auth';
import { isSetupComplete } from '$lib/server/settings';
import { bootApp } from '$lib/server/boot';

// Run one-time boot (secret guard → migrations → settings row → scheduler) at process
// start: adapter-node imports this module on `node build`, so a missing ROAMARR_SECRET
// or a failed migration fails the container now rather than on the first HTTP request.
// Idempotent; safe under Vite HMR (the `booted` flag short-circuits re-runs) and build
// (vite bundles without executing, and there are no prerender entries that would).
bootApp();

const PUBLIC = [/^\/setup/, /^\/login/, /^\/register/, /^\/share\//];

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = await validateSession(event.cookies.get('session'));
	const path = event.url.pathname;

	if (!isSetupComplete() && path !== '/setup') throw redirect(302, '/setup');
	if (isSetupComplete() && path === '/setup') throw redirect(302, '/login');

	const isPublic = PUBLIC.some((re) => re.test(path));
	if (!isPublic && !event.locals.user && isSetupComplete()) throw redirect(302, '/login');

	return resolve(event);
};
