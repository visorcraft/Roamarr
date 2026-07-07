import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTableParams } from '$lib/tableParams';
import { requireAdmin } from '$lib/server/auth';
import { listSchedulerRuns, countSchedulerRuns } from '$lib/server/repositories/remindersRepo';

export const GET: RequestHandler = ({ url, locals }) => {
	requireAdmin(locals);
	const { page, limit, search, dir } = parseTableParams(url, ['startedAt']);
	const offset = (page - 1) * limit;
	const rows = listSchedulerRuns({
		search,
		sortBy: 'startedAt',
		sortDir: dir,
		limit,
		offset
	}).map((r) => ({
		id: r.id,
		startedAt: r.startedAt,
		finishedAt: r.finishedAt,
		success: r.success,
		errorMessage: r.errorMessage
	}));
	const total = countSchedulerRuns(search);
	return json({ rows, total });
};
