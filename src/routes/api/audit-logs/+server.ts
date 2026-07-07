import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTableParams } from '$lib/tableParams';
import { requireAdmin } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { listAuditLogs } from '$lib/server/repositories/auditRepo';
import { parsePositiveInteger, parseIsoDateParam } from '$lib/server/auditParams';

export const GET: RequestHandler = async ({ url, locals, getClientAddress }) => {
	requireAdmin(locals);
	const limit = checkRateLimit(getClientAddress(), 'api:audit-logs:list');
	if (!limit.allowed) {
		throw error(429, `Rate limited. Try again in ${limit.retryAfter ?? 1} seconds.`);
	}

	const { page, limit: pageLimit, search } = parseTableParams(url);
	const offset = (page - 1) * pageLimit;
	const userId = parsePositiveInteger(url.searchParams.get('userId'));
	const action = url.searchParams.get('action') ?? undefined;
	const entityType = url.searchParams.get('entityType') ?? undefined;
	const from = parseIsoDateParam(url.searchParams.get('from'), 'from');
	const to = parseIsoDateParam(url.searchParams.get('to'), 'to');

	const { logs, total } = listAuditLogs({
		userId,
		action,
		entityType,
		from,
		to,
		search,
		limit: pageLimit,
		offset
	});
	return json({ rows: logs, total });
};
