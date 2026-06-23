import { error, fail, redirect, type Actions, type Load } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { getSettings } from '$lib/server/settings';
import { hashPassword, createSession } from '$lib/server/auth';

function gate() {
	const s = getSettings();
	if (!s.setupComplete || !s.allowRegistration) throw error(404, 'Not found');
}

export const load: Load = () => {
	gate();
	return {};
};

export async function registerUser(email: string, password: string, displayName: string) {
	return db
		.insert(users)
		.values({
			email: email.trim().toLowerCase(),
			passwordHash: await hashPassword(password),
			displayName,
			role: 'user'
		})
		.returning()
		.get();
}

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		gate();
		const f = await request.formData();
		const email = String(f.get('email') ?? ''),
			password = String(f.get('password') ?? ''),
			displayName = String(f.get('displayName') ?? '');
		if (!email || password.length < 8 || !displayName)
			return fail(400, { error: 'All fields required; password ≥ 8 chars.' });
		let u;
		try {
			u = await registerUser(email, password, displayName);
		} catch {
			return fail(409, { error: 'Email already registered.' });
		}
		cookies.set('session', await createSession(u.id), {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 30
		});
		throw redirect(303, '/');
	}
};
