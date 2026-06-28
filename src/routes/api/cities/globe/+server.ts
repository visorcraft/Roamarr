import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { citiesForGlobe } from '$lib/server/cities';

// Cities for the 3D globe modal: most-populous worldwide plus a denser set around the
// focus point. Fed to EarthCityGlobe.setCities(); no tile streaming needed.
export const GET: RequestHandler = ({ url, locals }) => {
	requireUser(locals);
	const lat = Number(url.searchParams.get('lat'));
	const lng = Number(url.searchParams.get('lng'));
	const center = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
	return json({ cities: citiesForGlobe(center) });
};
