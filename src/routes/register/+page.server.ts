import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSettings } from '$lib/server/settings';
import { createSession, sessionCookieOptions } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { registerUser } from '$lib/server/users';

function gate() {
	const s = getSettings();
	if (!s.setupComplete || !s.allowRegistration) throw error(404, 'Not found');
}

export const load: PageServerLoad = () => {
	gate();
	return {};
};

export async function _registerUser(email: string, password: string, displayName: string) {
	return registerUser(email, password, displayName);
}

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const limit = checkRateLimit(getClientAddress(), 'register');
		if (!limit.allowed)
			return fail(429, {
				error: 'Too many attempts. Try again later.',
				retryAfter: limit.retryAfter
			});
		gate();
		const f = await request.formData();
		const email = String(f.get('email') ?? ''),
			password = String(f.get('password') ?? ''),
			displayName = String(f.get('displayName') ?? '');
		if (!email || password.length < 8 || !displayName)
			return fail(400, { error: 'All fields required; password ≥ 8 chars.' });
		let u;
		try {
			u = await _registerUser(email, password, displayName);
		} catch (e) {
			if (e instanceof Error && e.message.includes('already registered')) {
				return fail(409, { error: 'Email already registered.' });
			}
			throw e;
		}
		cookies.set('session', createSession(u.id), sessionCookieOptions());
		throw redirect(303, '/');
	}
};
