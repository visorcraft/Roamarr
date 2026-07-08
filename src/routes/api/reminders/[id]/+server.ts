import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { getReminderById, deleteReminder } from '$lib/server/repositories/remindersRepo';
import { logAudit } from '$lib/server/audit';

export const DELETE: RequestHandler = async ({ params, locals, getClientAddress }) => {
	const u = requireUser(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found');

	const limit = checkRateLimit(getClientAddress(), 'api:reminders:delete');
	if (!limit.allowed) throw error(429, 'Too many requests');

	const reminder = getReminderById(id);
	if (!reminder || reminder.userId !== u.id) throw error(404, 'Not found');

	deleteReminder(id);
	logAudit(u.id, 'reminder_delete', 'reminder', id);
	return new Response(null, { status: 204 });
};
