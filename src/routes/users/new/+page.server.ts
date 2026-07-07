import { fail, type Actions } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { adminCreateUser } from '$lib/server/users';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	return {};
};

export const actions: Actions = {
	create: async ({ request, locals, getClientAddress }) => {
		const admin = requireAdmin(locals);
		const limit = checkRateLimit(getClientAddress(), 'users:create');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}
		const formData = await request.formData();
		const displayName = String(formData.get('displayName') ?? '');
		const email = String(formData.get('email') ?? '');
		const role = String(formData.get('role') ?? 'user');
		if (role !== 'admin' && role !== 'user') return fail(400, { error: 'Invalid role.' });

		try {
			const { temporaryPassword } = await adminCreateUser(admin.id, {
				displayName,
				email,
				role: role as 'admin' | 'user'
			});
			return { success: true, email, generatedPassword: temporaryPassword };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not create user.' });
		}
	}
};
