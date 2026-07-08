import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTableParams } from '$lib/tableParams';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { listReminders, countReminders } from '$lib/server/repositories/remindersRepo';

export const GET: RequestHandler = async ({ url, locals, getClientAddress }) => {
	const u = requireUser(locals);
	const limit = checkRateLimit(getClientAddress(), 'api:reminders:list');
	if (!limit.allowed) throw error(429, 'Too many requests');
	const { page, limit: pageLimit, search, sort, dir, from, to } = parseTableParams(url, [
		'fireAt',
		'status',
		'kind',
		'name',
		'createdAt'
	]);
	const offset = (page - 1) * pageLimit;
	const rows = listReminders(u.id, {
		search,
		sortBy: sort as 'fireAt' | 'status' | 'kind' | 'name' | 'createdAt' | undefined,
		sortDir: dir,
		from,
		to,
		limit: pageLimit,
		offset
	});
	const total = countReminders(u.id, { search, from, to });
	return json({
		rows: rows.map((r) => ({
			id: r.id,
			kind: r.kind,
			refType: r.refType,
			refId: r.refId,
			fireAt: r.fireAt,
			status: r.status,
			name: r.name,
			description: r.description,
			sentAt: r.sentAt,
			createdAt: r.createdAt
		})),
		total
	});
};
