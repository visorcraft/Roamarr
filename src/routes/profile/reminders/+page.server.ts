import { error, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { cancelReminder, listRemindersForUser } from '$lib/server/reminders';
import { updateReminder, getReminderById } from '$lib/server/repositories/remindersRepo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return { reminders: listRemindersForUser(u.id), timezone: u.timezone };
};

export const actions: Actions = {
	update: async ({ request, locals }) => {
		const u = requireUser(locals);
		const form = await request.formData();
		const id = Number(form.get('id'));
		const fireAt = String(form.get('fireAt') ?? '').trim();
		if (!Number.isFinite(id) || id <= 0) throw error(400, 'Invalid reminder');
		const existing = getReminderById(id);
		if (!existing || existing.userId !== u.id) throw error(404, 'Not found');
		if (!fireAt || Number.isNaN(Date.parse(fireAt))) throw error(400, 'Invalid fire time');
		updateReminder(id, { fireAt: new Date(fireAt).toISOString() });
		throw redirect(303, '/profile/reminders');
	},
	cancel: async ({ request, locals }) => {
		const u = requireUser(locals);
		const id = Number((await request.formData()).get('id'));
		if (!Number.isFinite(id) || id <= 0) throw error(400, 'Invalid reminder');
		cancelReminder(u.id, id);
		throw redirect(303, '/profile/reminders');
	}
};
