import { requireUser } from '$lib/server/auth';
import { kit } from '$lib/server/db';
import { users, trips, groups } from '$lib/server/db/mongrelSchema';
import { countSegments } from '$lib/server/repositories/segmentsRepo';
import { countNotifications } from '$lib/server/repositories/remindersRepo';
import { getSettings } from '$lib/server/settings';
import { appInfo } from '$lib/appInfo';
import { getDatabasePath } from '$lib/server/paths';
import type { PageServerLoad } from './$types';

function countTable(table: typeof users | typeof trips | typeof groups): number {
	return Number(kit.selectFrom(table).selectCount().executeSync());
}

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
					users: countTable(users),
					trips: countTable(trips),
					segments: Number(countSegments()),
					groups: countTable(groups),
					notifications: countNotifications()
				}
			: null
	};
};
