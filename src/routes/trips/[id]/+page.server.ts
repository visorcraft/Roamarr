import { requireUser } from '$lib/server/auth';
import { loadTripFor } from '../shared';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const u = requireUser(locals);
	return loadTripFor(u.id, Number(params.id));
};
