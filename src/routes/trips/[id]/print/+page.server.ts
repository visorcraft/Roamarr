import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { tripCompanions } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { loadTripFor } from '../../shared';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const u = requireUser(locals);
	const tripId = Number(params.id);
	const view = loadTripFor(u.id, tripId);
	const companions = db
		.select()
		.from(tripCompanions)
		.where(eq(tripCompanions.tripId, view.trip.id))
		.all();
	const segments = 'segments' in view ? view.segments : view.trip.segments;
	return {
		trip: view.trip,
		segments,
		companions,
		editor: view.editor,
		owner: view.owner
	};
};
