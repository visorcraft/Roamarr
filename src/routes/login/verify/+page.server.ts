import { fail, redirect, type Actions } from '@sveltejs/kit';
import { createSession, sessionCookieOptions } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { verifyPendingCookie, verifyTwoFactor } from '$lib/server/twoFactor';
import { getUserById } from '$lib/server/repositories/usersRepo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ request, cookies, getClientAddress }) => {
	const pending = verifyPendingCookie(
		cookies.get('tfa_pending'),
		getClientAddress(),
		request.headers.get('user-agent') ?? undefined
	);
	if (!pending) throw redirect(303, '/login');
	return {};
};

function safeNext(url: URL | undefined): string | null {
	if (!url) return null;
	const next = url.searchParams.get('next');
	if (!next) return null;
	if (next.startsWith('/') && !next.startsWith('//')) return next;
	return null;
}

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress, url }) => {
		const limit = checkRateLimit(getClientAddress(), 'tfa');
		if (!limit.allowed)
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });

		const pending = verifyPendingCookie(
			cookies.get('tfa_pending'),
			getClientAddress(),
			request.headers.get('user-agent') ?? undefined
		);
		if (!pending) throw redirect(303, '/login');

		const f = await request.formData();
		const code = String(f.get('code') ?? '').trim();

		if (!code) return fail(400, { error: 'Enter your 6-digit code or a backup code.' });

		if (!verifyTwoFactor(pending.userId, code)) {
			return fail(401, { error: 'Invalid code. Try again.' });
		}

		const user = getUserById(pending.userId);
		if (!user || user.disabled) {
			return fail(401, { error: 'Account disabled.' });
		}

		cookies.delete('tfa_pending', { path: '/' });
		const ip = getClientAddress();
		const ua = request.headers.get('user-agent') ?? undefined;
		cookies.set('session', createSession(pending.userId, ip, ua), sessionCookieOptions());
		throw redirect(303, safeNext(url) ?? '/');
	}
};
