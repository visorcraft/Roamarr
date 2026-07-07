import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { logAudit } from '$lib/server/audit';
import { setFlash } from '$lib/server/flash';
import { checkRateLimit } from '$lib/server/rateLimit';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { adminDisableTwoFactor, isTwoFactorEnabled } from '$lib/server/twoFactor';
import { adminSendPasswordReset, adminUpdateUser } from '$lib/server/users';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
	requireAdmin(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) throw error(404, 'Not found');

	const user = usersRepo.getUserById(id);
	if (!user) throw error(404, 'Not found');

	return {
		user: {
			id: Number(user.id),
			email: user.email,
			displayName: user.display_name ?? '',
			role: user.role,
			disabled: user.disabled,
			mustResetPassword: user.must_reset_password
		},
		twoFactorEnabled: isTwoFactorEnabled(id)
	};
};

function parseUpdate(formData: FormData) {
	const displayName = String(formData.get('displayName') ?? '');
	const email = String(formData.get('email') ?? '');
	const role = String(formData.get('role') ?? '');
	const disabled = formData.get('enabled') !== 'on';
	const mustResetPassword = formData.get('mustResetPassword') === 'on';
	const newPassword = String(formData.get('newPassword') ?? '');
	const confirmPassword = String(formData.get('confirmPassword') ?? '');

	if (role !== 'admin' && role !== 'user') return { error: 'Invalid role.' };

	return {
		displayName,
		email,
		role: role as 'admin' | 'user',
		disabled,
		mustResetPassword,
		newPassword,
		confirmPassword
	};
}

export const actions: Actions = {
	update: async ({ params, request, locals, cookies, getClientAddress }) => {
		const admin = requireAdmin(locals);
		const limit = checkRateLimit(getClientAddress(), 'users:update');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}
		const id = Number(params.id);
		if (!Number.isInteger(id) || id <= 0) throw error(404, 'Not found');

		const parsed = parseUpdate(await request.formData());
		if ('error' in parsed) return fail(400, { error: parsed.error });

		try {
			await adminUpdateUser(admin.id, id, parsed);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update failed.' });
		}

		setFlash(cookies, 'User updated.');
		throw redirect(303, '/users');
	},

	sendReset: async ({ params, locals, cookies, url, getClientAddress }) => {
		const admin = requireAdmin(locals);
		const limit = checkRateLimit(getClientAddress(), 'users:sendReset');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}
		const id = Number(params.id);
		if (!Number.isInteger(id) || id <= 0) throw error(404, 'Not found');

		try {
			await adminSendPasswordReset(id, url.origin);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not send reset link.' });
		}

		logAudit(admin.id, 'user_password_reset_sent', 'user', id);
		setFlash(cookies, 'Password reset link sent.');
		throw redirect(303, '/users');
	},

	disableTwoFactor: async ({ params, locals, cookies, getClientAddress }) => {
		const admin = requireAdmin(locals);
		const limit = checkRateLimit(getClientAddress(), 'users:disableTwoFactor');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}
		const id = Number(params.id);
		if (!Number.isInteger(id) || id <= 0) throw error(404, 'Not found');

		try {
			adminDisableTwoFactor(admin.id, id);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not disable 2FA.' });
		}

		setFlash(cookies, 'Two-factor authentication disabled for user.');
		throw redirect(303, '/users');
	}
};
