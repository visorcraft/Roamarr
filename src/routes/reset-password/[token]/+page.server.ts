import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { validatePasswordResetToken, consumePasswordResetToken } from '$lib/server/passwordReset';
import { checkRateLimit } from '$lib/server/rateLimit';

export const load: PageServerLoad = ({ params }) => {
	if (!validatePasswordResetToken(params.token)) throw error(404, 'Invalid or expired reset link');
	return { token: params.token };
};

export const actions: Actions = {
	default: async ({ request, params, getClientAddress }) => {
		const limit = checkRateLimit(getClientAddress(), 'reset-password');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}
		const token = params.token;
		if (!token) throw error(404, 'Invalid or expired reset link');
		const f = await request.formData();
		const password = String(f.get('password') ?? '');
		const confirmPassword = String(f.get('confirmPassword') ?? '');
		if (password.length < 8) return fail(400, { error: 'Password must be at least 8 characters.' });
		if (password !== confirmPassword) return fail(400, { error: 'Passwords do not match.' });
		const ok = await consumePasswordResetToken(token, password);
		if (!ok) return fail(400, { error: 'Invalid or expired reset link.' });
		throw redirect(303, '/login');
	}
};
