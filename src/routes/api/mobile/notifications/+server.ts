import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { listNotifications, markAllRead, markRead, markUnread } from '$lib/server/notifications';

export const GET: RequestHandler = ({ locals }) => json({ rows: listNotifications(requireUser(locals).id) });

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const user = requireUser(locals), body = await request.json().catch(() => { throw error(400, 'Invalid JSON'); }) as Record<string, unknown>, action = String(body.action ?? '');
	if (action === 'all-read') markAllRead(user.id);
	else {
		const id = Number(body.id); if (!Number.isSafeInteger(id) || id < 1) throw error(400, 'Invalid notification id');
		if (action === 'read') markRead(user.id, id); else if (action === 'unread') markUnread(user.id, id); else throw error(400, 'Unknown action');
	}
	return new Response(null, { status: 204 });
};
