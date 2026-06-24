import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { fareProviders, fareWatches } from '$lib/server/db/schema';
import { loadTripFor, type TripView } from '../shared';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const u = requireUser(locals);
	const view = loadTripFor(u.id, Number(params.id));
	if (view.owner) {
		const providers = db
			.select({ id: fareProviders.id, providerKey: fareProviders.providerKey })
			.from(fareProviders)
			.where(and(eq(fareProviders.userId, u.id), eq(fareProviders.enabled, true)))
			.all();
		const watches = db
			.select({
				id: fareWatches.id,
				status: fareWatches.status,
				providerKey: fareProviders.providerKey,
				lastCheckedAt: fareWatches.lastCheckedAt,
				lastResultJson: fareWatches.lastResultJson
			})
			.from(fareWatches)
			.innerJoin(fareProviders, eq(fareWatches.providerId, fareProviders.id))
			.where(eq(fareWatches.tripId, view.trip.id))
			.all();
		return { ...view, providers, watches } as TripView & {
			providers: { id: number; providerKey: string }[];
			watches: typeof watches;
		};
	}
	return view;
};
