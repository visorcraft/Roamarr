import { requireUser } from '$lib/server/auth';
import { listViewableTrips } from '$lib/server/sharing';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return { trips: listViewableTrips(u.id) };
};
