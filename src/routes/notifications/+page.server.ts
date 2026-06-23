import { redirect, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { notifications } from '$lib/server/db/schema';
import { nowIso } from '$lib/server/tz';
import type { PageServerLoad } from './$types';

export function _markRead(userId: number, id: number) {
	db.update(notifications)
		.set({ readAt: nowIso() })
		.where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
		.run();
}

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return {
		notifications: db
			.select()
			.from(notifications)
			.where(eq(notifications.userId, u.id))
			.all()
	};
};

export const actions: Actions = {
	markRead: async ({ request, locals }) => {
		const u = requireUser(locals);
		_markRead(u.id, Number((await request.formData()).get('id')));
		throw redirect(303, '/notifications');
	}
};
