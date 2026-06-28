import { requireAdmin } from '$lib/server/auth';
import { exportAuditLogsCsv, listAuditLogs } from '$lib/server/audit';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 50;

export const load: PageServerLoad = ({ locals, url }) => {
	requireAdmin(locals);
	const userIdRaw = url.searchParams.get('userId');
	const action = url.searchParams.get('action') ?? undefined;
	const entityType = url.searchParams.get('entityType') ?? undefined;
	const from = url.searchParams.get('from') ?? undefined;
	const to = url.searchParams.get('to') ?? undefined;
	const userId = userIdRaw ? Number(userIdRaw) : undefined;

	if (url.searchParams.get('export') === 'csv') {
		const csv = exportAuditLogsCsv({ userId, action, entityType, from, to });
		return new Response(csv, {
			headers: {
				'Content-Type': 'text/csv',
				'Content-Disposition': 'attachment; filename="audit-logs.csv"'
			}
		});
	}

	const pageRaw = Number(url.searchParams.get('page') ?? 1);
	const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
	const { logs, total } = listAuditLogs({
		userId,
		action,
		entityType,
		from,
		to,
		limit: PAGE_SIZE,
		offset: (page - 1) * PAGE_SIZE
	});
	const allUsers = usersRepo.listAllUsers().map((u) => ({
		id: Number(u.id),
		email: u.email,
		displayName: u.display_name ?? ''
	}));
	return { logs, total, page, pageSize: PAGE_SIZE, filters: { userId, action, entityType, from, to }, users: allUsers };
};
