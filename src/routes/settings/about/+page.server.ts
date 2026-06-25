import { count } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { groups, notifications, segments, trips, users } from '$lib/server/db/schema';
import { getSettings } from '$lib/server/settings';
import { appInfo } from '$lib/appInfo';
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
		databasePath: isAdmin ? (process.env.DATABASE_PATH ?? '/data/roamarr.db') : null,
		stats: isAdmin
			? {
					users: db.select({ count: count() }).from(users).get()?.count ?? 0,
					trips: db.select({ count: count() }).from(trips).get()?.count ?? 0,
					segments: db.select({ count: count() }).from(segments).get()?.count ?? 0,
					groups: db.select({ count: count() }).from(groups).get()?.count ?? 0,
					notifications: db.select({ count: count() }).from(notifications).get()?.count ?? 0
				}
			: null
	};
};
