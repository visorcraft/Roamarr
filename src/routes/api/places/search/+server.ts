import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { searchPlaceCatalog } from '$lib/server/placeSearch';

export const GET: RequestHandler = async ({ url, locals, getClientAddress }) => {
	requireUser(locals);
	const limit = checkRateLimit(getClientAddress(), 'places:search', {
		maxAttempts: 30,
		windowMs: 60_000
	});
	if (!limit.allowed) {
		return json({ results: [], error: 'Too many attempts. Try again later.' }, { status: 429 });
	}
	const q = url.searchParams.get('q')?.trim() ?? '';
	if (q.length < 2) return json({ results: [] });
	const outcome = await searchPlaceCatalog(q);
	// Graceful degradation: offline/timeout still lets the form save manually.
	if (!outcome.ok) return json({ results: [], error: outcome.error });
	return json({ results: outcome.results, provider: outcome.provider, warning: outcome.warning ?? null });
};
