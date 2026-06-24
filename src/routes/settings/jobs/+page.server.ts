import { desc } from 'drizzle-orm';
import { redirect, type Actions } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { schedulerRuns } from '$lib/server/db/schema';
import { runTick } from '$lib/server/scheduler';
import type { PageServerLoad } from './$types';

const RECENT_LIMIT = 50;

export const actions: Actions = {
	runNow: async ({ locals }) => {
		requireAdmin(locals);
		await runTick(new Date());
		throw redirect(303, '/settings/jobs');
	}
};

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	const runs = db
		.select({
			id: schedulerRuns.id,
			startedAt: schedulerRuns.startedAt,
			finishedAt: schedulerRuns.finishedAt,
			success: schedulerRuns.success,
			errorMessage: schedulerRuns.errorMessage
		})
		.from(schedulerRuns)
		.orderBy(desc(schedulerRuns.startedAt))
		.limit(RECENT_LIMIT)
		.all();
	return { runs };
};
