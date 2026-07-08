import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { getTravelDocumentById, deleteTravelDocument } from '$lib/server/repositories/profileRepo';
import { cancelRemindersFor } from '$lib/server/reminders';
import { logAudit } from '$lib/server/audit';

export const DELETE: RequestHandler = async ({ params, locals, getClientAddress }) => {
	const u = requireUser(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found');

	const limit = checkRateLimit(getClientAddress(), 'api:travel-documents:delete');
	if (!limit.allowed) throw error(429, 'Too many requests');

	const doc = getTravelDocumentById(id, u.id);
	if (!doc) throw error(404, 'Not found');

	cancelRemindersFor('document', id);
	deleteTravelDocument(id, u.id);
	logAudit(u.id, 'document_delete', 'document', id);
	return new Response(null, { status: 204 });
};
