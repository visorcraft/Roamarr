import { requireUser } from '$lib/server/auth';
import { globalSearch } from '$lib/server/embeddings/search';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const u = requireUser(locals);
	const rawQ = url.searchParams.get('q') ?? undefined;
	const q = rawQ?.trim() || undefined;
	if (!q) {
		return { trips: [], hits: [], semantic: false, q: undefined };
	}
	const result = await globalSearch(u.id, q);
	return {
		trips: result.trips,
		hits: result.hits,
		semantic: result.semantic,
		q: result.q
	};
};
