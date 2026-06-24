import { error, redirect, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { fareProviders, fareWatches, trips } from '$lib/server/db/schema';
import {
	duplicateTrip,
	loadTripFor,
	regenerateCalendarToken,
	revokeCalendarToken,
	type TripView
} from '../shared';
import { requireOwnedTrip } from '$lib/server/ownership';
import { upsertCustomReminder } from '$lib/server/reminders';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, url }) => {
	const u = requireUser(locals);
	const view = loadTripFor(u.id, Number(params.id));
	if (view.owner) {
		const providers = db
			.select({
				id: fareProviders.id,
				providerKey: fareProviders.providerKey,
				label: fareProviders.label
			})
			.from(fareProviders)
			.where(and(eq(fareProviders.userId, u.id), eq(fareProviders.enabled, true)))
			.all();
		const watches = db
			.select({
				id: fareWatches.id,
				status: fareWatches.status,
				providerKey: fareProviders.providerKey,
				label: fareProviders.label,
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
		const publicShareUrl = view.trip.publicToken
			? `${url.origin}/share/${encodeURIComponent(view.trip.publicToken)}`
			: null;
		return { ...view, providers, watches, feedUrl, publicShareUrl } as TripView & {
			providers: { id: number; providerKey: string; label: string }[];
			watches: typeof watches;
			feedUrl: string | null;
			publicShareUrl: string | null;
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
	},
	duplicate: async ({ locals, params }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		const copy = duplicateTrip(u.id, tripId);
		throw redirect(303, `/trips/${copy.id}`);
	},
	toggleArchive: async ({ locals, params }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		const t = requireOwnedTrip(u.id, tripId);
		db.update(trips).set({ archived: !t.archived }).where(eq(trips.id, tripId)).run();
		throw redirect(303, `/trips/${tripId}`);
	},
	toggleFavorite: async ({ locals, params }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		const t = requireOwnedTrip(u.id, tripId);
		db.update(trips).set({ favorite: !t.favorite }).where(eq(trips.id, tripId)).run();
		throw redirect(303, `/trips/${tripId}`);
	},
	customReminder: async ({ locals, params, request }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		const t = requireOwnedTrip(u.id, tripId);
		const f = await request.formData();
		const offset = Number(f.get('offsetMinutes') ?? 60);
		if (!Number.isFinite(offset) || offset < 0) throw error(400, 'Invalid offset');
		if (!t.startDate) throw error(400, 'Trip has no start date');
		const startAt = `${t.startDate}T09:00:00Z`;
		upsertCustomReminder(u.id, 'trip', tripId, startAt, offset);
		throw redirect(303, `/trips/${tripId}`);
	}
};
