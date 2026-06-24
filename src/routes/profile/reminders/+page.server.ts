import { error, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { cancelReminder, listRemindersForUser } from '$lib/server/reminders';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return { reminders: listRemindersForUser(u.id) };
};

export const actions: Actions = {
	cancel: async ({ request, locals }) => {
		const u = requireUser(locals);
		const id = Number((await request.formData()).get('id'));
		if (!Number.isFinite(id) || id <= 0) throw error(400, 'Invalid reminder');
		cancelReminder(u.id, id);
		throw redirect(303, '/profile/reminders');
	}
};
