import { fail, redirect, type Actions } from '@sveltejs/kit';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { verifyPassword, createSession, sessionCookieOptions } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { normalizeEmail } from '$lib/server/users';

export async function _authenticate(email: string, password: string) {
	const u = usersRepo.getUserByEmail(normalizeEmail(email));
	if (!u || u.disabled || !(await verifyPassword(u.password_hash, password))) return null;
	return {
		id: Number(u.id),
		email: u.email,
		displayName: u.display_name ?? '',
		role: u.role,
		disabled: u.disabled,
		mustResetPassword: u.must_reset_password,
		timezone: u.timezone,
		emailNotifications: u.email_notifications,
		webhookNotifications: u.webhook_notifications
	};
}

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const limit = checkRateLimit(getClientAddress(), 'login');
		if (!limit.allowed)
			return fail(429, {
				error: 'Too many attempts. Try again later.',
				retryAfter: limit.retryAfter
			});
		const f = await request.formData();
		const u = await _authenticate(String(f.get('email') ?? ''), String(f.get('password') ?? ''));
		if (!u) return fail(401, { error: 'Invalid email or password.' });
		const ip = getClientAddress();
		const ua = request.headers.get('user-agent') ?? undefined;
		cookies.set('session', createSession(u.id, ip, ua), sessionCookieOptions());
		throw redirect(303, '/');
	}
};
