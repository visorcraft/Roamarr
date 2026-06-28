import { getSettings } from '$lib/server/settings';
import { countUnreadNotificationsForUser } from '$lib/server/repositories/remindersRepo';
import { appInfo } from '$lib/appInfo';
import { themeForId } from '$lib/themes';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	const s = getSettings();
	const unreadCount = locals.user ? countUnreadNotificationsForUser(locals.user.id) : 0;
	const theme = themeForId(locals.user?.themeId);
	return {
		user: locals.user
			? { id: locals.user.id, email: locals.user.email, displayName: locals.user.displayName, role: locals.user.role }
			: null,
		appName: appInfo.name,
		appVersion: appInfo.version,
		themeId: theme.id,
		themeColor: theme.themeColor,
		instanceName: s.instanceName,
		allowRegistration: s.allowRegistration,
		flash: locals.flash,
		unreadCount
	};
};
