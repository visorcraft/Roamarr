import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { _regenerateUserCalendarToken } from '$lib/server/profileActions';
import { getUserById } from '$lib/server/repositories/usersRepo';

const result = (user: ReturnType<typeof requireUser>, origin: string) => ({
	feedUrl: user.calendarToken ? `${origin}/calendar/feed?token=${encodeURIComponent(user.calendarToken)}` : null,
	expiresAt: user.calendarTokenExpiresAt
});

export const GET: RequestHandler = ({ locals, url }) => json(result(requireUser(locals), url.origin));

export const POST: RequestHandler = async ({ locals, request, url }) => {
	const user = requireUser(locals);
	const body = await request.json().catch(() => ({})) as { expiresAt?: unknown };
	_regenerateUserCalendarToken(user.id, typeof body.expiresAt === 'string' && body.expiresAt ? body.expiresAt : null);
	const updated = getUserById(user.id)!;
	return json({
		feedUrl: updated.calendar_token ? `${url.origin}/calendar/feed?token=${encodeURIComponent(updated.calendar_token)}` : null,
		expiresAt: updated.calendar_token_expires_at
	});
};
