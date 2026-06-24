import { error, redirect, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { fareProviders, fareWatches } from '$lib/server/db/schema';
import {
	loadTripFor,
	regenerateCalendarToken,
	revokeCalendarToken,
	type TripView
} from '../shared';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, url }) => {
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
		const feedUrl = view.trip.calendarToken
			? `${url.origin}/trips/${view.trip.id}/calendar/feed?token=${encodeURIComponent(view.trip.calendarToken)}`
			: null;
		return { ...view, providers, watches, feedUrl } as TripView & {
			providers: { id: number; providerKey: string }[];
			watches: typeof watches;
			feedUrl: string | null;
		};
	}
	return view;
};

export const actions: Actions = {
	regenerateCalendarFeed: async ({ locals, params }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		regenerateCalendarToken(u.id, tripId);
		throw redirect(303, `/trips/${tripId}`);
	},
	revokeCalendarFeed: async ({ locals, params }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		revokeCalendarToken(u.id, tripId);
		throw redirect(303, `/trips/${tripId}`);
	}
};
