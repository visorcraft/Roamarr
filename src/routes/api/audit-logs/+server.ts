import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { DateTime } from 'luxon';
import { parseTableParams } from '$lib/tableParams';
import { requireAdmin } from '$lib/server/auth';
import { listAuditLogs } from '$lib/server/repositories/auditRepo';

function parsePositiveInteger(raw: string | null): number | undefined {
	if (raw == null || raw === '') return undefined;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1) throw error(400, 'Invalid userId');
	return value;
}

function parseIsoDateParam(raw: string | null, name: string): string | undefined {
	if (raw == null || raw === '') return undefined;
	if (!DateTime.fromISO(raw).isValid) throw error(400, `Invalid ${name} date`);
	return raw;
}

export const GET: RequestHandler = async ({ url, locals }) => {
	requireAdmin(locals);
	const { page, limit, search } = parseTableParams(url);
	const offset = (page - 1) * limit;
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
		limit,
		offset
	});
	return json({ rows: logs, total });
};
