import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { listAdmin1Options } from '$lib/server/cities';

export const GET: RequestHandler = ({ url, locals }) => {
	requireUser(locals);
	const country = url.searchParams.get('country');
	if (!country || !/^[A-Za-z]{2}$/.test(country)) {
		throw error(400, 'country must be a 2-letter ISO code');
	}
	const admin1 = listAdmin1Options(country.toUpperCase());
	return json({ admin1 });
};
