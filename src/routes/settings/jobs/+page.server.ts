import { desc } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { schedulerRuns } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

const RECENT_LIMIT = 50;

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
