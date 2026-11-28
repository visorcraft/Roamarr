import { listViewableTrips, canView, viewerProjection } from '../sharing';
import * as tripsRepo from '../repositories/tripsRepo';
import {
	embeddingsReady,
	semanticSearch,
	type SearchHit
} from './index';

export type GlobalSearchTrip = ReturnType<typeof listViewableTrips>[number];

export type GlobalSearchResult = {
	/** Trip cards for the existing search UI (semantic and/or lexical). */
	trips: GlobalSearchTrip[];
	/** Flattened ANN hits (trips + segments + places) when embeddings are ready. */
	hits: SearchHit[];
	/** Whether ANN semantic ranking was used. */
	semantic: boolean;
	q: string;
};

/**
 * Global account search. When MiniLM embeddings are ready, ranks via MongrelDB
 * ANN and hydrates trip cards; otherwise falls back to substring matching.
 */
export async function globalSearch(userId: number, rawQuery: string): Promise<GlobalSearchResult> {
	const q = rawQuery.trim();
	if (!q) {
		return { trips: [], hits: [], semantic: false, q: '' };
	}

	if (embeddingsReady()) {
		const hits = await semanticSearch(userId, q, 40);
		// Hydrate only the matched trip IDs, in ANN order, deduplicated.
		const ordered: GlobalSearchTrip[] = [];
		const added = new Set<number>();
		for (const h of hits) {
			let tripId: number | undefined;
			if (h.tripId !== undefined) {
				tripId = h.tripId;
			} else {
				const m = h.href.match(/\/trips\/(\d+)/);
				tripId = m ? Number(m[1]) : undefined;
			}
			if (tripId === undefined || added.has(tripId)) continue;
			added.add(tripId);
			const trip = tripsRepo.getTripById(tripId);
			if (!trip || trip.archived) continue;
			if (!canView(userId, trip)) continue;
			ordered.push(
				trip.ownerId === userId
					? { ...trip, isShared: false }
					: { ...viewerProjection(trip, [], false), isShared: true }
			);
		}

		// If ANN found nothing viewable, fall back to lexical for empty-corpus safety.
		if (ordered.length === 0) {
			const lexical = listViewableTrips(userId, { q, filter: 'active' });
			return { trips: lexical, hits, semantic: true, q };
		}
		return { trips: ordered, hits, semantic: true, q };
	}

	const trips = listViewableTrips(userId, { q, filter: 'active' });
	return { trips, hits: [], semantic: false, q };
}

/** Fire-and-forget reindex helper so write paths never block on embeddings. */
export function scheduleIndexTrip(tripId: number): void {
	if (!embeddingsReady()) return;
	void import('./index')
		.then((m) => m.indexTrip(tripId))
		.catch((e) => console.error('[embeddings] indexTrip failed', tripId, e));
}

export function scheduleRemoveTrip(tripId: number): void {
	void import('./index')
		.then((m) => {
			m.removeTripSearchDocuments(tripId);
		})
		.catch(() => {});
}

/** Fire-and-forget saved-place index helpers; no-ops when embeddings are off. */
export function scheduleIndexPlace(placeId: number): void {
	if (!embeddingsReady()) return;
	void import('./index')
		.then((m) => m.indexPlace(placeId))
		.catch((e) => console.error('[embeddings] indexPlace failed', placeId, e));
}

export function scheduleRemovePlace(placeId: number): void {
	void import('./index')
		.then((m) => m.removeSearchDocument('place', placeId))
		.catch(() => {});
}
