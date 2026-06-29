import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { logAudit } from '$lib/server/audit';
import { setFlash } from '$lib/server/flash';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { adminCreateUser, adminDeleteUser, adminSendPasswordReset, adminUpdateUser } from '$lib/server/users';
import { adminDisableTwoFactor, isTwoFactorEnabled } from '$lib/server/twoFactor';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	const rows = usersRepo.listAllUsers().map((u) => ({
		id: Number(u.id),
		email: u.email,
		displayName: u.display_name ?? '',
		role: u.role,
		disabled: u.disabled,
		mustResetPassword: u.must_reset_password,
		createdAt: u.created_at,
		twoFactorEnabled: isTwoFactorEnabled(Number(u.id))
	}));
	return { users: rows };
};

function parseUpdate(formData: FormData) {
	const userId = Number(formData.get('userId'));
	const displayName = String(formData.get('displayName') ?? '');
	const email = String(formData.get('email') ?? '');
	const role = String(formData.get('role') ?? '');
	const disabled = formData.get('enabled') !== 'on';
	const mustResetPassword = formData.get('mustResetPassword') === 'on';
	const newPassword = String(formData.get('newPassword') ?? '');
	const confirmPassword = String(formData.get('confirmPassword') ?? '');

	if (!Number.isInteger(userId) || userId <= 0) return { error: 'Invalid user.' };
	if (role !== 'admin' && role !== 'user') return { error: 'Invalid role.' };

	return {
		userId,
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
	create: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const formData = await request.formData();
		const displayName = String(formData.get('displayName') ?? '');
		const email = String(formData.get('email') ?? '');
		const role = String(formData.get('role') ?? 'user');
		if (role !== 'admin' && role !== 'user') return fail(400, { error: 'Invalid role.' });

		try {
			const { temporaryPassword } = await adminCreateUser(admin.id, { displayName, email, role: role as 'admin' | 'user' });
			return { success: true, email, generatedPassword: temporaryPassword };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not create user.' });
		}
	},

	delete: async ({ request, locals, cookies }) => {
		const admin = requireAdmin(locals);
		const userId = Number((await request.formData()).get('userId'));
		if (!Number.isInteger(userId) || userId <= 0) return fail(400, { error: 'Invalid user.' });

		try {
			await adminDeleteUser(admin.id, userId);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not delete user.' });
		}

		setFlash(cookies, 'User deleted.');
		throw redirect(303, '/settings/users');
	},

	update: async ({ request, locals, cookies }) => {
		const admin = requireAdmin(locals);
		const parsed = parseUpdate(await request.formData());
		if ('error' in parsed) return fail(400, { error: parsed.error });

		try {
			await adminUpdateUser(admin.id, parsed.userId, parsed);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update failed.' });
		}

		setFlash(cookies, 'User updated.');
		throw redirect(303, '/settings/users');
	},

	sendReset: async ({ request, locals, cookies, url }) => {
		const admin = requireAdmin(locals);
		const userId = Number((await request.formData()).get('userId'));
		if (!Number.isInteger(userId) || userId <= 0) return fail(400, { error: 'Invalid user.' });

		try {
			await adminSendPasswordReset(userId, url.origin);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not send reset link.' });
		}

		logAudit(admin.id, 'user_password_reset_sent', 'user', userId);
		setFlash(cookies, 'Password reset link sent.');
		throw redirect(303, '/settings/users');
	},

	disableTwoFactor: async ({ request, locals, cookies }) => {
		const admin = requireAdmin(locals);
		const userId = Number((await request.formData()).get('userId'));
		if (!Number.isInteger(userId) || userId <= 0) return fail(400, { error: 'Invalid user.' });

		try {
			adminDisableTwoFactor(admin.id, userId);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not disable 2FA.' });
		}

		setFlash(cookies, 'Two-factor authentication disabled for user.');
		throw redirect(303, '/settings/users');
	}
};
