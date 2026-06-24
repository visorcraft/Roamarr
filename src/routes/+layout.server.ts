import { getSettings } from '$lib/server/settings';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
	user: locals.user
		? { displayName: locals.user.displayName, role: locals.user.role }
		: null,
	instanceName: getSettings().instanceName
});
