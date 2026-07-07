import { redirect, type Actions } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { runTick } from '$lib/server/scheduler';
import type { PageServerLoad } from './$types';

export const actions: Actions = {
	runNow: async ({ locals }) => {
		requireAdmin(locals);
		await runTick(new Date());
		throw redirect(303, '/jobs');
	}
};

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	return {};
};
