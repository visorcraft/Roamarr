import { and, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from './db';
import { trips, cards, fareProviders, segments } from './db/schema';

export function requireOwnedTrip(userId: number, tripId: number) {
	const t = db
		.select()
		.from(trips)
		.where(and(eq(trips.id, tripId), eq(trips.ownerId, userId)))
		.get();
	if (!t) throw error(404, 'Not found');
	return t;
}

export function assertOwnedRefs(
	userId: number,
	refs: {
		cardId?: number | null;
		tripId?: number | null;
		providerId?: number | null;
		segmentId?: number | null;
	}
) {
	if (refs.tripId != null) requireOwnedTrip(userId, refs.tripId);
	if (refs.cardId != null) {
		const c = db
			.select()
			.from(cards)
			.where(and(eq(cards.id, refs.cardId), eq(cards.userId, userId)))
			.get();
		if (!c) throw error(403, 'Forbidden');
	}
	if (refs.providerId != null) {
		const p = db
			.select()
			.from(fareProviders)
			.where(and(eq(fareProviders.id, refs.providerId), eq(fareProviders.userId, userId)))
			.get();
		if (!p) throw error(403, 'Forbidden');
	}
	if (refs.segmentId != null) {
		const s = db
			.select({ tripId: segments.tripId })
			.from(segments)
			.where(eq(segments.id, refs.segmentId))
			.get();
		if (!s) throw error(404, 'Not found');
		requireOwnedTrip(userId, s.tripId);
	}
}
