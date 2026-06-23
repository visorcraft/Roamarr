import { redirect, type Handle } from '@sveltejs/kit';
import { validateSession } from '$lib/server/auth';
import { isSetupComplete } from '$lib/server/settings';
import { startScheduler } from '$lib/server/scheduler';
import { bootApp } from '$lib/server/boot';

startScheduler();

const PUBLIC = [/^\/setup/, /^\/login/, /^\/register/, /^\/share\//];

export const handle: Handle = async ({ event, resolve }) => {
	bootApp();
	event.locals.user = await validateSession(event.cookies.get('session'));
	const path = event.url.pathname;

	if (!isSetupComplete() && path !== '/setup') throw redirect(302, '/setup');
	if (isSetupComplete() && path === '/setup') throw redirect(302, '/login');

	const isPublic = PUBLIC.some((re) => re.test(path));
	if (!isPublic && !event.locals.user && isSetupComplete()) throw redirect(302, '/login');

	return resolve(event);
};
