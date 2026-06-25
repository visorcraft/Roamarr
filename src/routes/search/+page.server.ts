import { requireUser } from '$lib/server/auth';
import { listViewableTrips } from '$lib/server/sharing';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const u = requireUser(locals);
	const rawQ = url.searchParams.get('q') ?? undefined;
	const q = rawQ?.trim() || undefined;
	return { trips: q ? listViewableTrips(u.id, { q, filter: 'active' }) : [], q };
};
