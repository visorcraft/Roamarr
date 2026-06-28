import { requireUser } from '$lib/server/auth';
import { parseTripId } from '$lib/server/params';
import { listTripCompanions } from '$lib/server/tripCompanions';
import { loadTripFor } from '../../shared';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const u = requireUser(locals);
	const tripId = parseTripId(params);
	const view = loadTripFor(u.id, tripId);
	const companions = listTripCompanions(view.trip.id);
	const segments = 'segments' in view ? view.segments : view.trip.segments;
	return {
		trip: view.trip,
		segments,
		companions,
		editor: view.editor,
		owner: view.owner
	};
};
