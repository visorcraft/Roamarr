import { requireUser } from '$lib/server/auth';
import { getCreditsData } from '$lib/server/licenseAttribution';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireUser(locals);
	return getCreditsData();
};
