import { requireUser } from '$lib/server/auth';
import { countSegments } from '$lib/server/repositories/segmentsRepo';
import { countNotifications } from '$lib/server/repositories/remindersRepo';
import { countUsers } from '$lib/server/repositories/usersRepo';
import { countTrips, countGroups } from '$lib/server/repositories/tripsRepo';
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
					users: countUsers(),
					trips: countTrips(),
					segments: Number(countSegments()),
					groups: countGroups(),
					notifications: countNotifications()
				}
			: null
	};
};
