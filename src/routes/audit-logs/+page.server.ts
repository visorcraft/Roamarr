import { requireAdmin } from '$lib/server/auth';
import { exportAuditLogsCsv } from '$lib/server/audit';
import type { PageServerLoad } from './$types';

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

	return {};
};
