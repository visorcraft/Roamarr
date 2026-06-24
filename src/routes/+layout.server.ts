import { getSettings } from '$lib/server/settings';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	const s = getSettings();
	return {
		user: locals.user
			? { displayName: locals.user.displayName, role: locals.user.role }
			: null,
		instanceName: s.instanceName,
		allowRegistration: s.allowRegistration,
		flash: locals.flash
	};
};
