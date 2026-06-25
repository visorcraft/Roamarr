import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
import {
	listNotifications,
	markRead,
	markUnread,
	markAllRead
} from '$lib/server/notifications';
import { positiveIdFromForm } from '$lib/server/validation';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return { notifications: listNotifications(u.id) };
};

export const actions: Actions = {
	markRead: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const idResult = positiveIdFromForm(f.get('id'), 'id');
		if (!idResult.ok) return fail(400, { error: idResult.error });
		markRead(u.id, idResult.value);
		throw redirect(303, '/notifications');
	},
	markUnread: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const idResult = positiveIdFromForm(f.get('id'), 'id');
		if (!idResult.ok) return fail(400, { error: idResult.error });
		markUnread(u.id, idResult.value);
		throw redirect(303, '/notifications');
	},
	markAllRead: async ({ cookies, locals }) => {
		const u = requireUser(locals);
		markAllRead(u.id);
		setFlash(cookies, 'All notifications marked read.');
		throw redirect(303, '/notifications');
	}
};
