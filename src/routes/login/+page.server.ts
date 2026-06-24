import { fail, redirect, type Actions } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { verifyPassword, createSession, sessionCookieOptions } from '$lib/server/auth';

export async function _authenticate(email: string, password: string) {
	const u = db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).get();
	if (!u || !(await verifyPassword(u.passwordHash, password))) return null;
	return u;
}

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const f = await request.formData();
		const u = await _authenticate(String(f.get('email') ?? ''), String(f.get('password') ?? ''));
		if (!u) return fail(401, { error: 'Invalid email or password.' });
		cookies.set('session', await createSession(u.id), sessionCookieOptions());
		throw redirect(303, '/');
	}
};
