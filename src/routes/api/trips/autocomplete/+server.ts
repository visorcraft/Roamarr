import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';

export const GET: RequestHandler = async ({ url, locals, getClientAddress }) => {
	const u = requireUser(locals);
	const limit = checkRateLimit(getClientAddress(), 'api:trips:autocomplete');
	if (!limit.allowed) throw error(429, 'Too many requests');

	const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
	const all = tripsRepo.listTripsForUser(u.id);
	const filtered = q
		? all.filter(
				(t) =>
					t.name.toLowerCase().includes(q) ||
					(t.destination ?? '').toLowerCase().includes(q) ||
					(t.destinationCityName ?? '').toLowerCase().includes(q)
			)
		: all;
	const trips = filtered.slice(0, 20).map((t) => ({
		id: t.id,
		label: t.name,
		secondary: [t.destinationCityName, t.destinationCountryCode, t.startDate, t.endDate]
			.filter(Boolean)
			.join(' · ')
	}));
	return json({ trips });
};
