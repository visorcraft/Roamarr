import { redirect, type Handle, isRedirect, type Redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { validateSession, updateSessionMetadata } from '$lib/server/auth';
import { isSetupComplete } from '$lib/server/settings';
import { bootApp, isMissingSecret, getBootError } from '$lib/server/boot';
import { tileCspOrigins } from '$lib/server/mapTiles';
import type { ToastVariant } from '$lib/toast';

// Run one-time boot (secret guard → migrations → settings row → scheduler) at process
// start. A failed migration or missing ROAMARR_SECRET is recorded so the setup page
// can render diagnostics instead of crashing the process. The handle hook below blocks
// every other route and the setup action when boot did not complete.
// Idempotent; safe under Vite HMR (the `booted` flag short-circuits re-runs) and build
// (vite bundles without executing, and there are no prerender entries that would).
bootApp();

const PUBLIC = [/^\/setup/, /^\/login/, /^\/register/, /^\/forgot-password/, /^\/reset-password\//, /^\/share\//, /^\/trips\/\d+\/calendar\/feed$/, /^\/api\/webauthn\/auth\//, /^\/oauth\/authorize/, /^\/oauth\/token/, /^\/oauth\/revoke/, /^\/\.well-known\//, /^\/mcp/, /^\/health$/, /^\/health\/deep$/];

function contentSecurityPolicy() {
	// Allow the configured map tile provider (origin only) so MapLibre can fetch tiles,
	// and blob: workers since MapLibre runs its renderer in a blob-sourced Web Worker.
	const tiles = tileCspOrigins();
	const directives: Record<string, string[]> = {
		'default-src': ["'self'"],
		'script-src': ["'self'", "'unsafe-inline'"],
		'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
		'font-src': ["'self'", 'https://fonts.gstatic.com'],
		'img-src': ["'self'", 'data:', 'blob:', ...tiles],
		'connect-src': [...(dev ? ["'self'", 'ws:', 'wss:'] : ["'self'"]), ...tiles],
		'worker-src': ["'self'", 'blob:'],
		'form-action': ["'self'"],
		'base-uri': ["'self'"],
		'frame-ancestors': ["'none'"],
		'object-src': ["'none'"]
	};
	return Object.entries(directives)
		.map(([directive, values]) => `${directive} ${values.join(' ')}`)
		.join('; ');
}

function isAllowedDuringSetupIssue(path: string) {
	return (
		path === '/setup' ||
		path.startsWith('/_app/') ||
		path.startsWith('/static/') ||
		path.startsWith('/maps/') ||
		path === '/favicon.ico' ||
		path === '/manifest.json' ||
		path.startsWith('/icon-') ||
		path === '/apple-touch-icon.png' ||
		path === '/logo-transparent.png' ||
		path === '/alt-logo-transparent.png'
	);
}

function applySecurityHeaders(response: Response) {
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Content-Security-Policy', contentSecurityPolicy());
	// HSTS is ignored by browsers over plain HTTP, so it is safe to send in dev,
	// but only meaningful when the app is served over HTTPS.
	response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
	return response;
}

function redirectResponse(e: Redirect) {
	return new Response(null, { status: e.status, headers: { location: e.location } });
}

export const handle: Handle = async ({ event, resolve }) => {
	try {
		const path = event.url.pathname;
		const bootError = getBootError();

		if (isMissingSecret() || bootError) {
			event.locals.user = null;
			event.locals.missingSecret = isMissingSecret();
			event.locals.bootError = bootError;
			if (!isAllowedDuringSetupIssue(path)) {
				throw redirect(307, '/setup');
			}
			return applySecurityHeaders(await resolve(event));
		}

		const sessionToken = event.cookies.get('session');
		event.locals.user = await validateSession(sessionToken);
		if (sessionToken && event.locals.user) {
			try {
				updateSessionMetadata(sessionToken, event.getClientAddress(), event.request.headers.get('user-agent') ?? undefined);
			} catch {
				// best-effort; getClientAddress may throw in some environments
			}
		}

		const flashRaw = event.cookies.get('flash');
		if (flashRaw) {
			let flash: string | { message: string; variant?: ToastVariant } = flashRaw;
			try {
				const parsed = JSON.parse(flashRaw);
				if (parsed && typeof parsed.message === 'string') {
					const variant = ['success', 'error', 'info', 'warning'].includes(parsed.variant)
						? (parsed.variant as ToastVariant)
						: undefined;
					flash = { message: parsed.message, variant };
				}
			} catch {
				// keep plain string flash
			}
			event.locals.flash = flash;
			event.cookies.set('flash', '', { path: '/', maxAge: 0 });
		}

		if (!isSetupComplete() && path !== '/setup' && path !== '/health' && path !== '/health/deep') throw redirect(302, '/setup');
		if (isSetupComplete() && path === '/setup') throw redirect(302, '/login');

		const isPublic = PUBLIC.some((re) => re.test(path));
		if (!isPublic && !event.locals.user && isSetupComplete()) throw redirect(302, '/login');

		if (event.locals.user?.mustResetPassword) {
			const allowed = path === '/profile/change-password' || path === '/logout';
			if (!allowed) throw redirect(302, '/profile/change-password');
		}

		return applySecurityHeaders(await resolve(event));
	} catch (e) {
		if (isRedirect(e)) return applySecurityHeaders(redirectResponse(e));
		throw e;
	}
};
