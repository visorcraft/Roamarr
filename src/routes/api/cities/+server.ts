import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { searchCities } from '$lib/server/cities';

export const GET: RequestHandler = ({ url, locals }) => {
	requireUser(locals);
	const country = url.searchParams.get('country');
	const q = url.searchParams.get('q');
	if (!country || !/^[A-Za-z]{2}$/.test(country)) {
		throw error(400, 'country must be a 2-letter ISO code');
	}
	if (!q || q.length < 2) {
		return json({ cities: [] });
	}
	const cities = searchCities(country, q, 20);
	return json({ cities });
};
