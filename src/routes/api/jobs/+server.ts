import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTableParams } from '$lib/tableParams';
import { requireAdmin } from '$lib/server/auth';
import { listSchedulerRuns, countSchedulerRuns } from '$lib/server/repositories/remindersRepo';

export const GET: RequestHandler = async ({ url, locals }) => {
	requireAdmin(locals);
	const rawDir = url.searchParams.get('dir');
	const params = parseTableParams(url, ['startedAt']);
	const dir: 'asc' | 'desc' = rawDir === null ? 'desc' : params.dir;
	const offset = (params.page - 1) * params.limit;
	const rows = listSchedulerRuns({
		search: params.search,
		sortBy: (params.sort as 'startedAt' | null) ?? 'startedAt',
		sortDir: dir,
		from: params.from,
		to: params.to,
		limit: params.limit,
		offset
	}).map((r) => ({
		id: r.id,
		startedAt: r.startedAt,
		finishedAt: r.finishedAt,
		success: r.success,
		errorMessage: r.errorMessage
	}));
	const total = countSchedulerRuns(params.search, params.from, params.to);
	return json({ rows, total });
};
