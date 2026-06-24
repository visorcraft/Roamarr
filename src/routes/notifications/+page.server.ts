import { redirect, type Actions } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
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

export function _markUnread(userId: number, id: number) {
	db.update(notifications)
		.set({ readAt: null })
		.where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
		.run();
}

export function _markAllRead(userId: number) {
	db.update(notifications)
		.set({ readAt: nowIso() })
		.where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
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
	},
	markUnread: async ({ request, locals }) => {
		const u = requireUser(locals);
		_markUnread(u.id, Number((await request.formData()).get('id')));
		throw redirect(303, '/notifications');
	},
	markAllRead: async ({ cookies, locals }) => {
		const u = requireUser(locals);
		_markAllRead(u.id);
		setFlash(cookies, 'All notifications marked read.');
		throw redirect(303, '/notifications');
	}
};
