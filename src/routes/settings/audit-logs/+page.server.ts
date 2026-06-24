import { requireAdmin } from '$lib/server/auth';
import { listAuditLogs } from '$lib/server/audit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	return { logs: listAuditLogs(100) };
};
