import { redirect, type Actions } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { listRecentSchedulerRuns } from '$lib/server/repositories/remindersRepo';
import { runTick } from '$lib/server/scheduler';
import type { PageServerLoad } from './$types';

const RECENT_LIMIT = 50;

export const actions: Actions = {
	runNow: async ({ locals }) => {
		requireAdmin(locals);
		await runTick(new Date());
		throw redirect(303, '/jobs');
	}
};

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	const runs = listRecentSchedulerRuns(RECENT_LIMIT);
	return { runs };
};
