import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
import { _changeEmail } from '$lib/server/profileActions';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return { email: u.email };
};

export const actions: Actions = {
	changeEmail: async ({ cookies, request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const currentPassword = String(f.get('currentPassword') ?? '');
		const newEmail = String(f.get('newEmail') ?? '');
		const confirmEmail = String(f.get('confirmEmail') ?? '');
		try {
			await _changeEmail(u.id, { currentPassword, newEmail, confirmEmail });
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Email change failed' });
		}
		setFlash(cookies, 'Email changed.');
		throw redirect(303, '/profile/email');
	}
};
