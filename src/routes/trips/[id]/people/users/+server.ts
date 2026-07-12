import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { requireOwnedTrip } from '$lib/server/ownership';
import { parseTripId } from '$lib/server/params';
import { listUsers } from '$lib/server/repositories/usersRepo';
import { checkRateLimit } from '$lib/server/rateLimit';

export const GET: RequestHandler = ({ locals, params, url, getClientAddress }) => {
	const user = requireUser(locals);
	requireOwnedTrip(user.id, parseTripId(params));
	const query = url.searchParams.get('q')?.trim() ?? '';
	if (query.length < 2) return json({ users: [] });
	if (!checkRateLimit(getClientAddress(), 'api:trip-users:autocomplete').allowed) throw error(429, 'Too many requests');
	const users = listUsers({ search: query, sortBy: 'displayName', limit: 8 })
		.filter((candidate) => !candidate.disabled && Number(candidate.id) !== user.id)
		.map((candidate) => ({ id: Number(candidate.id), label: candidate.display_name, secondary: candidate.email }));
	return json({ users });
};
