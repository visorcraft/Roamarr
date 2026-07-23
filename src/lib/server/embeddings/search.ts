import { listViewableTrips } from '../sharing';
import type { Trip } from '../repositories/tripsRepo';
import * as tripsRepo from '../repositories/tripsRepo';
import {
	embeddingsReady,
	semanticSearch,
	type SearchHit
} from './index';

export type GlobalSearchResult = {
	/** Trip cards for the existing search UI (semantic and/or lexical). */
	trips: Array<
		| (Trip & { isShared: false })
		| (ReturnType<typeof listViewableTrips>[number] & { isShared?: boolean })
	>;
	/** Flattened ANN hits (trips + segments) when embeddings are ready. */
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
		const tripIds = new Set<number>();
		for (const h of hits) {
			if (h.entityType === 'trip') tripIds.add(h.entityId);
			else if (h.entityType === 'segment') {
				// href is /trips/{id}; resolve via trip list below
			}
		}
		// Collect trip ids from segment hits via href or entity re-fetch.
		const tripsMap = new Map<number, GlobalSearchResult['trips'][number]>();
		const viewable = listViewableTrips(userId, { filter: 'active' });
		const byId = new Map(viewable.map((t) => [t.id, t]));

		for (const h of hits) {
			if (h.entityType === 'trip') {
				const t = byId.get(h.entityId);
				if (t) tripsMap.set(t.id, t);
			} else if (h.entityType === 'segment') {
				const m = h.href.match(/\/trips\/(\d+)/);
				const tripId = m ? Number(m[1]) : 0;
				const t = byId.get(tripId);
				if (t) tripsMap.set(t.id, t);
			}
		}

		// Preserve ANN order for trips as first-seen in hits.
		const ordered: GlobalSearchResult['trips'] = [];
		const added = new Set<number>();
		for (const h of hits) {
			let tripId = 0;
			if (h.entityType === 'trip') tripId = h.entityId;
			else {
				const m = h.href.match(/\/trips\/(\d+)/);
				tripId = m ? Number(m[1]) : 0;
			}
			if (!tripId || added.has(tripId)) continue;
			const t = tripsMap.get(tripId);
			if (!t) continue;
			// Skip archived unless already filtered by listViewableTrips active filter.
			added.add(tripId);
			ordered.push(t);
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
			m.removeSearchDocument('trip', tripId);
			// Segments cascade-deleted from DB; leftover segment docs are cleaned on reindex.
			void tripId;
		})
		.catch(() => {});
}
