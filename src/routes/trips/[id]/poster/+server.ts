import { requireUser } from '$lib/server/auth';
import { parseTripId } from '$lib/server/params';
import { readTripPoster } from '$lib/server/tripPoster';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const user = requireUser(locals);
	const tripId = parseTripId(params);
	const { stream, record } = await readTripPoster(user.id, tripId);
	return new Response(stream, {
		headers: {
			'Content-Type': record.contentType,
			'Cache-Control': 'private, no-store'
		}
	});
};
