import { fail, type Actions } from '@sveltejs/kit';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { createPasswordResetToken } from '$lib/server/passwordReset';
import { deliver } from '$lib/server/notify';
import { checkRateLimit } from '$lib/server/rateLimit';
import { normalizeEmail } from '$lib/server/users';

export async function _requestReset(email: string, origin: string) {
	const u = usersRepo.getUserByEmail(normalizeEmail(email));
	if (!u || u.disabled) return;
	const token = createPasswordResetToken(Number(u.id));
	const link = `${origin}/reset-password/${token}`;
	await deliver(Number(u.id), {
		title: 'Reset your Roamarr password',
		body: 'Click the link below to reset your password. This link expires in 1 hour.',
		link
	});
}

export const actions: Actions = {
	default: async ({ request, url, getClientAddress }) => {
		const limit = checkRateLimit(getClientAddress(), 'forgot-password');
		if (!limit.allowed)
			return fail(429, {
				error: 'Too many attempts. Try again later.',
				retryAfter: limit.retryAfter
			});
		const f = await request.formData();
		const email = String(f.get('email') ?? '');
		if (!email) return fail(400, { error: 'Email is required.' });
		await _requestReset(email, url.origin);
		return { success: true };
	}
};
