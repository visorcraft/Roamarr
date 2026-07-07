import { error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { exportAuditLogsCsv } from '$lib/server/audit';
import { parsePositiveInteger, parseIsoDateParam } from '$lib/server/auditParams';
import type { PageServerLoad } from './$types';

export interface AuditLogFilters {
	userId: string;
	action: string;
	entityType: string;
	from: string;
	to: string;
}

export const load: PageServerLoad = ({ locals, url }) => {
	requireAdmin(locals);
	const userIdRaw = url.searchParams.get('userId');
	const action = url.searchParams.get('action') ?? '';
	const entityType = url.searchParams.get('entityType') ?? '';
	const from = url.searchParams.get('from') ?? '';
	const to = url.searchParams.get('to') ?? '';

	const filters: AuditLogFilters = {
		userId: userIdRaw ?? '',
		action,
		entityType,
		from,
		to
	};

	if (url.searchParams.get('export') === 'csv') {
		const userId = parsePositiveInteger(userIdRaw);
		const parsedFrom = parseIsoDateParam(url.searchParams.get('from'), 'from');
		const parsedTo = parseIsoDateParam(url.searchParams.get('to'), 'to');
		const csv = exportAuditLogsCsv({
			userId,
			action: action || undefined,
			entityType: entityType || undefined,
			from: parsedFrom,
			to: parsedTo
		});
		return new Response(csv, {
			headers: {
				'Content-Type': 'text/csv',
				'Content-Disposition': 'attachment; filename="audit-logs.csv"'
			}
		});
	}

	return { filters };
};
