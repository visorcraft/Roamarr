import { redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
import { _regenerateUserCalendarToken } from '$lib/server/profileActions';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const u = requireUser(locals);
	const feedUrl = u.calendarToken
		? `${url.origin}/calendar/feed?token=${encodeURIComponent(u.calendarToken)}`
		: null;
	return {
		feedUrl,
		calendarTokenExpiresAt: u.calendarTokenExpiresAt
	};
};

export const actions: Actions = {
	regenerateCalendarToken: async ({ cookies, request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const expiresAt = String(f.get('calendarExpiresAt') || '');
		_regenerateUserCalendarToken(u.id, expiresAt || null);
		setFlash(cookies, 'Calendar feed URL regenerated.');
		throw redirect(303, '/profile/calendar');
	}
};
