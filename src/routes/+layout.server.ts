import { and, count, eq, isNull } from 'drizzle-orm';
import { getSettings } from '$lib/server/settings';
import { db } from '$lib/server/db';
import { notifications } from '$lib/server/db/schema';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	const s = getSettings();
	let unreadCount = 0;
	if (locals.user) {
		const row = db
			.select({ count: count() })
			.from(notifications)
			.where(and(eq(notifications.userId, locals.user.id), isNull(notifications.readAt)))
			.get();
		unreadCount = row?.count ?? 0;
	}
	return {
		user: locals.user
			? { displayName: locals.user.displayName, role: locals.user.role }
			: null,
		instanceName: s.instanceName,
		allowRegistration: s.allowRegistration,
		flash: locals.flash,
		unreadCount
	};
};
