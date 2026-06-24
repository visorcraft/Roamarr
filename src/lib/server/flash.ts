import { dev } from '$app/environment';
import type { Cookies } from '@sveltejs/kit';

/**
 * Cookie options for flash messages. Mirrors session cookie transport settings
 * but uses a short max-age so stale flashes disappear quickly if not consumed.
 */
export function flashCookieOptions() {
	const origin = process.env.ORIGIN;
	const secure = dev ? false : !(origin && origin.startsWith('http://'));
	return {
		path: '/',
		httpOnly: true,
		secure,
		sameSite: 'lax' as const,
		maxAge: 60
	};
}

/** Set a one-time flash message cookie. The hook reads and clears it on the next request. */
export function setFlash(cookies: Cookies, message: string) {
	cookies.set('flash', message, flashCookieOptions());
}
