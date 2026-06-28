import { count } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { groups, trips, users } from '$lib/server/db/schema';
import { countSegments } from '$lib/server/repositories/segmentsRepo';
import { countNotifications } from '$lib/server/repositories/remindersRepo';
import { getSettings } from '$lib/server/settings';
import { appInfo } from '$lib/appInfo';
import { getDatabasePath } from '$lib/server/paths';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const user = requireUser(locals);
	const isAdmin = user.role === 'admin';
	const s = getSettings();

	return {
		app: appInfo,
		instanceName: s.instanceName,
		isAdmin,
		environment: process.env.NODE_ENV ?? 'development',
		databasePath: isAdmin ? getDatabasePath() : null,
		stats: isAdmin
			? {
					users: db.select({ count: count() }).from(users).get()?.count ?? 0,
					trips: db.select({ count: count() }).from(trips).get()?.count ?? 0,
					segments: Number(countSegments()),
					groups: db.select({ count: count() }).from(groups).get()?.count ?? 0,
					notifications: countNotifications()
				}
			: null
	};
};
