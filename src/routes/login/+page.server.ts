import { fail, redirect, type Actions } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { verifyPassword, createSession, sessionCookieOptions } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';

export async function _authenticate(email: string, password: string) {
	const u = db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).get();
	if (!u || !(await verifyPassword(u.passwordHash, password))) return null;
	return u;
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
		cookies.set('session', createSession(u.id), sessionCookieOptions());
		throw redirect(303, '/');
	}
};
