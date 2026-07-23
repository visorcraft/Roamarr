import { requireUser } from '$lib/server/auth';
import { countSegments } from '$lib/server/repositories/segmentsRepo';
import { countNotifications } from '$lib/server/repositories/remindersRepo';
import { countUsers } from '$lib/server/repositories/usersRepo';
import { countTrips, countGroups } from '$lib/server/repositories/tripsRepo';
import { getSettings } from '$lib/server/settings';
import { appInfo } from '$lib/appInfo';
import { getDatabasePath } from '$lib/server/paths';
import { getMongrelRuntimeInfo } from '$lib/server/mongrelRuntimeInfo';
import type { PageServerLoad } from './$types';

const ALLOWED_TABS = ['application', 'instance', 'licenses'] as const;
type AboutTab = (typeof ALLOWED_TABS)[number];

export const load: PageServerLoad = ({ locals, url }) => {
	const user = requireUser(locals);
	const isAdmin = user.role === 'admin';
	const s = getSettings();
	const tabParam = url.searchParams.get('tab') ?? 'application';
	const tab: AboutTab = (ALLOWED_TABS as readonly string[]).includes(tabParam)
		? (tabParam as AboutTab)
		: 'application';

	return {
		app: appInfo,
		instanceName: s.instanceName,
		isAdmin,
		environment: process.env.NODE_ENV ?? 'development',
		databasePath: isAdmin ? getDatabasePath() : null,
		// Admin-only: native build + package versions help confirm a MongrelDB upgrade took effect.
		mongrel: isAdmin ? getMongrelRuntimeInfo() : null,
		stats: isAdmin
			? {
					users: countUsers(),
					trips: countTrips(),
					segments: Number(countSegments()),
					groups: countGroups(),
					notifications: countNotifications()
				}
			: null,
		tab
	};
};
