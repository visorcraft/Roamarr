import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { eq } from '@visorcraft/mongreldb-kit';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const context = vi.hoisted(() => ({ kit: null as never }));
vi.mock('../db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(context, freshDb());
	return context;
});

// Spy on listViewableTrips (wrapping the real implementation) so the semantic
// path can be proven not to call it.
vi.mock('../sharing', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../sharing')>();
	return {
		...actual,
		listViewableTrips: vi.fn(actual.listViewableTrips)
	};
});

import { searchDocuments, segments } from '../db/mongrelSchema';
import { makeUser, makeTrip, makeSegment } from '../../../../tests/helpers';
import { createPlace, deletePlace } from '../places';
import * as tripsRepo from '../repositories/tripsRepo';
import { listViewableTrips } from '../sharing';
import {
	disableEmbeddings,
	enableEmbeddings,
	embeddingsReady,
	getEmbeddingsConfig,
	indexPlace,
	indexTrip,
	removeTripSearchDocuments,
	semanticSearch,
	setEmbeddingsConfig,
	DEFAULT_EMBEDDINGS_CONFIG
} from './index';
import { hashEmbed, setTestEmbedFn } from './model';
import { globalSearch } from './search';

const db = () => (context as { kit: KitDatabase }).kit;

beforeEach(() => {
	setTestEmbedFn(async (text) => hashEmbed(text));
	setEmbeddingsConfig({ ...DEFAULT_EMBEDDINGS_CONFIG });
	vi.mocked(listViewableTrips).mockClear();
	for (const row of db().selectFrom(searchDocuments).executeSync()) {
		db().deleteFrom(searchDocuments).where(eq(searchDocuments.id, row.id)).executeSync();
	}
});

afterEach(() => {
	setTestEmbedFn(null);
	setEmbeddingsConfig({ ...DEFAULT_EMBEDDINGS_CONFIG });
});

test('embeddings default to disabled', () => {
	expect(getEmbeddingsConfig().enabled).toBe(false);
	expect(embeddingsReady()).toBe(false);
});

test('enableEmbeddings indexes trips and powers semantic search', async () => {
	const user = makeUser(db(), { email: 'emb-a@x.c' });
	const trip = makeTrip(db(), user.id, {
		name: 'Kyoto Cherry Blossom Week',
		destinationCityName: 'Kyoto'
	});
	makeSegment(db(), trip.id, {
		title: 'Train to Gion',
		type: 'train',
		location: 'Gion'
	});

	const cfg = await enableEmbeddings();
	expect(cfg.status).toBe('ready');
	expect(embeddingsReady()).toBe(true);

	const hits = await semanticSearch(user.id, 'japan spring flowers temple district', 10);
	expect(hits.length).toBeGreaterThan(0);
	const types = new Set(hits.map((h) => h.entityType));
	expect(types.has('trip') || types.has('segment')).toBe(true);

	const global = await globalSearch(user.id, 'cherry blossom japan');
	expect(global.semantic).toBe(true);
	expect(global.trips.some((t) => t.id === trip.id)).toBe(true);
});

test('disableEmbeddings turns off semantic ranking', async () => {
	const user = makeUser(db(), { email: 'emb-b@x.c' });
	makeTrip(db(), user.id, { name: 'Paris Weekend' });
	await enableEmbeddings();
	expect(embeddingsReady()).toBe(true);
	await disableEmbeddings();
	expect(embeddingsReady()).toBe(false);
	const global = await globalSearch(user.id, 'Paris');
	expect(global.semantic).toBe(false);
	expect(global.trips.some((t) => t.name.includes('Paris'))).toBe(true);
});


test('disable during enable leaves semantic search disabled', async () => {
	const enabling = enableEmbeddings();
	await disableEmbeddings();
	await expect(enabling).resolves.toMatchObject({ enabled: false, status: 'disabled' });
	expect(embeddingsReady()).toBe(false);
});

test('indexTrip removes orphaned segment docs after a segment is deleted', async () => {
	const user = makeUser(db(), { email: 'emb-orphan@x.c' });
	const trip = makeTrip(db(), user.id, { name: 'Orphan Cleanup Trip' });
	const s1 = makeSegment(db(), trip.id, { title: 'Doomed Train' });
	const s2 = makeSegment(db(), trip.id, { title: 'Surviving Train' });

	await enableEmbeddings();

	const segDocs = () =>
		db()
			.selectFrom(searchDocuments)
			.where(eq(searchDocuments.entity_type, 'segment'))
			.executeSync()
			.filter((r) => r.href === `/trips/${trip.id}`);

	expect(segDocs().map((r) => Number(r.entity_id))).toEqual(
		[s1.id, s2.id].sort((a, b) => a - b)
	);

	// Delete the segment row directly so its search document is orphaned.
	db().deleteFrom(segments).where(eq(segments.id, BigInt(s1.id))).executeSync();

	await indexTrip(trip.id);

	const remaining = segDocs().map((r) => Number(r.entity_id));
	expect(remaining).toContain(s2.id);
	expect(remaining).not.toContain(s1.id);

	const tripDocs = db()
		.selectFrom(searchDocuments)
		.where(eq(searchDocuments.entity_type, 'trip'))
		.executeSync()
		.filter((r) => r.href === `/trips/${trip.id}`);
	expect(tripDocs.map((r) => Number(r.entity_id))).toContain(trip.id);
});

test('removeTripSearchDocuments removes trip and its segment docs only', async () => {
	const user = makeUser(db(), { email: 'emb-rm@x.c' });
	const tripA = makeTrip(db(), user.id, { name: 'Removal A' });
	makeSegment(db(), tripA.id, { title: 'A1' });
	makeSegment(db(), tripA.id, { title: 'A2' });
	const tripB = makeTrip(db(), user.id, { name: 'Removal B' });
	const segB1 = makeSegment(db(), tripB.id, { title: 'B1' });

	await enableEmbeddings();

	removeTripSearchDocuments(tripA.id);

	const docs = db().selectFrom(searchDocuments).executeSync();
	const aDocs = docs.filter((r) => r.href === `/trips/${tripA.id}`);
	expect(aDocs).toHaveLength(0);

	const bDocs = docs.filter((r) => r.href === `/trips/${tripB.id}`);
	expect(bDocs.some((r) => r.entity_type === 'trip' && Number(r.entity_id) === tripB.id)).toBe(true);
	expect(
		bDocs.some((r) => r.entity_type === 'segment' && Number(r.entity_id) === segB1.id)
	).toBe(true);
});

test('semanticSearch returns tripId on trip and segment hits, not on place hits', async () => {
	const user = makeUser(db(), { email: 'emb-hits@x.c' });
	const trip = makeTrip(db(), user.id, {
		name: 'Kyoto Cherry Blossom Week',
		destinationCityName: 'Kyoto'
	});
	const seg = makeSegment(db(), trip.id, {
		title: 'Train to Gion',
		type: 'train',
		location: 'Gion'
	});
	const place = createPlace(user.id, {
		name: 'Gion Temple Garden',
		description: 'temple district garden'
	});

	await enableEmbeddings();
	await indexPlace(place.id);

	const hits = await semanticSearch(user.id, 'kyoto train temple', 20);

	const tripHits = hits.filter((h) => h.entityType === 'trip' && h.entityId === trip.id);
	expect(tripHits.length).toBeGreaterThan(0);
	expect(tripHits[0].tripId).toBe(trip.id);

	const segHits = hits.filter((h) => h.entityType === 'segment' && h.entityId === seg.id);
	expect(segHits.length).toBeGreaterThan(0);
	expect(segHits[0].tripId).toBe(trip.id);

	const placeHits = hits.filter((h) => h.entityType === 'place' && h.entityId === place.id);
	expect(placeHits.length).toBeGreaterThan(0);
	expect(placeHits[0].tripId).toBeUndefined();

	await deletePlace(place.id, user.id);
});

test('globalSearch hydrates active owned & shared trips in ANN order without listViewableTrips', async () => {
	const viewer = makeUser(db(), { email: 'emb-gs-viewer@x.c' });
	const sharedOwner = makeUser(db(), { email: 'emb-gs-owner@x.c' });

	const ownedTrip = makeTrip(db(), viewer.id, {
		name: 'Alpha Kyoto Trip',
		destinationCityName: 'Kyoto'
	});
	makeSegment(db(), ownedTrip.id, { title: 'Alpha Kyoto Segment', location: 'Kyoto' });
	const archivedTrip = makeTrip(db(), viewer.id, {
		name: 'Alpha Kyoto Archive',
		destinationCityName: 'Kyoto',
		archived: true
	});
	const sharedTrip = makeTrip(db(), sharedOwner.id, {
		name: 'Alpha Kyoto Shared',
		destinationCityName: 'Kyoto',
		notes: 'private owner notes'
	});
	tripsRepo.createShare({ tripId: sharedTrip.id, sharedWithUserId: viewer.id, permission: 'read' });

	await enableEmbeddings();

	const result = await globalSearch(viewer.id, 'alpha kyoto');
	expect(result.semantic).toBe(true);
	expect(vi.mocked(listViewableTrips)).not.toHaveBeenCalled();

	const ids = result.trips.map((t) => t.id);
	expect(ids).toContain(ownedTrip.id);
	expect(ids).toContain(sharedTrip.id);
	expect(ids).not.toContain(archivedTrip.id);

	const owned = result.trips.find((t) => t.id === ownedTrip.id);
	const shared = result.trips.find((t) => t.id === sharedTrip.id);
	expect(owned?.isShared).toBe(false);
	expect(shared?.isShared).toBe(true);
	expect('notes' in shared!).toBe(false);

	// ANN order: first-seen trip order in the hits, minus the archived trip.
	const hitTripIds: number[] = [];
	for (const h of result.hits) {
		let tripId: number | undefined = h.tripId;
		if (tripId === undefined) {
			const m = h.href.match(/\/trips\/(\d+)/);
			tripId = m ? Number(m[1]) : undefined;
		}
		if (tripId !== undefined && !hitTripIds.includes(tripId)) hitTripIds.push(tripId);
	}
	const expected = hitTripIds.filter((id) => id !== archivedTrip.id);
	expect(ids).toEqual(expected);
});
