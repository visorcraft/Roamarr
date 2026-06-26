import { dev } from '$app/environment';
import type { Cookies } from '@sveltejs/kit';
import type { ToastVariant } from '$lib/toast';

type FlashMessage = {
	message: string;
	variant?: ToastVariant;
};

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

/** Set a one-time flash message cookie. The hook reads and clears it on the next request.
 *  Accepts a plain string (treated as a success message) or an object with a `variant`.
 */
export function setFlash(cookies: Cookies, payload: string | FlashMessage) {
	if (typeof payload === 'string') {
		cookies.set('flash', payload, flashCookieOptions());
		return;
	}
	const { message, variant } = payload;
	const value = variant && variant !== 'success' ? JSON.stringify({ message, variant }) : message;
	cookies.set('flash', value, flashCookieOptions());
}
