import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTableParams } from '$lib/tableParams';
import { requireAdmin } from '$lib/server/auth';
import { listAuditLogs } from '$lib/server/repositories/auditRepo';

function parsePositiveIntParam(raw: string | null): number | undefined {
	if (raw == null || raw === '') return undefined;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1) throw error(400, 'Invalid userId');
	return value;
}

export const GET: RequestHandler = ({ url, locals }) => {
	requireAdmin(locals);
	const { page, limit, search } = parseTableParams(url);
	const offset = (page - 1) * limit;
	const userId = parsePositiveIntParam(url.searchParams.get('userId'));
	const action = url.searchParams.get('action') ?? undefined;
	const entityType = url.searchParams.get('entityType') ?? undefined;
	const from = url.searchParams.get('from') ?? undefined;
	const to = url.searchParams.get('to') ?? undefined;

	const { logs, total } = listAuditLogs({
		userId,
		action,
		entityType,
		from,
		to,
		search,
		limit,
		offset
	});
	return json({ rows: logs, total });
};
