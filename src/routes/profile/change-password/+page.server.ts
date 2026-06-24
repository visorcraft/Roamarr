import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
import { completeRequiredPasswordChange } from '$lib/server/users';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	if (!u.mustResetPassword) throw redirect(303, '/profile');
	return { email: u.email };
};

export const actions: Actions = {
	default: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const token = cookies.get('session');
		if (!token) throw redirect(302, '/login');

		const f = await request.formData();
		const newPassword = String(f.get('newPassword') ?? '');
		const confirmPassword = String(f.get('confirmPassword') ?? '');

		try {
			await completeRequiredPasswordChange(u.id, token, newPassword, confirmPassword);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Password update failed.' });
		}

		setFlash(cookies, 'Password updated.');
		throw redirect(303, '/');
	}
};
