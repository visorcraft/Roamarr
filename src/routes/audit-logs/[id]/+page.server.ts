import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/auth';
import { getAuditLogById } from '$lib/server/repositories/auditRepo';
import { auditEntityUrl } from '$lib/server/auditEntityUrl';

export const load: PageServerLoad = ({ params, locals }) => {
	requireAdmin(locals);
	const id = Number(params.id);
	if (!Number.isFinite(id) || id <= 0) {
		throw error(404, 'Audit log entry not found');
	}
	const log = getAuditLogById(id);
	if (!log) {
		throw error(404, 'Audit log entry not found');
	}
	return {
		log,
		entityUrl: auditEntityUrl(log)
	};
};
