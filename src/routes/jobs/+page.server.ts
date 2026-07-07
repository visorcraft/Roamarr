import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { runTick } from '$lib/server/scheduler';
import { checkRateLimit } from '$lib/server/rateLimit';
import { logAudit } from '$lib/server/audit';
import type { PageServerLoad } from './$types';

export const actions: Actions = {
	runNow: async ({ locals, getClientAddress }) => {
		const admin = requireAdmin(locals);
		const limit = checkRateLimit(getClientAddress(), 'jobs:runNow');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}
		await runTick(new Date());
		logAudit(admin.id, 'scheduler_run_manual', 'scheduler_run', 1);
		throw redirect(303, '/jobs');
	}
};

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	return {};
};
