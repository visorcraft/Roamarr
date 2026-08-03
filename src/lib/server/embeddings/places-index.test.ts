import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { eq } from '@visorcraft/mongreldb-kit';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const context = vi.hoisted(() => ({ kit: null as never }));
vi.mock('../db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(context, freshDb());
	return context;
});

import {
	geonamesCities,
	placeCategories,
	places,
	searchDocuments,
	users
} from '../db/mongrelSchema';
import { makeUser } from '../../../../tests/helpers';
import {
	createPlace,
	createPlaceCategory,
	deletePlace,
	setPlaceVisited,
	updatePlace,
	updatePlaceCategory
} from '../places';
import {
	disableEmbeddings,
	enableEmbeddings,
	embeddingsReady,
	indexPlace,
	semanticSearch,
	setEmbeddingsConfig,
	DEFAULT_EMBEDDINGS_CONFIG
} from './index';
import { hashEmbed, setTestEmbedFn } from './model';

const db = () => (context as { kit: KitDatabase }).kit;

function placeDocs(placeId?: number) {
	let rows = db()
		.selectFrom(searchDocuments)
		.where(eq(searchDocuments.entity_type, 'place'))
		.executeSync();
	if (placeId != null) rows = rows.filter((r) => Number(r.entity_id) === placeId);
	return rows;
}

function makeCity(geonameId: number, name: string) {
	db()
		.insertInto(geonamesCities)
		.values({
			geoname_id: BigInt(geonameId),
			name,
			ascii_name: name,
			country_code: 'JP',
			admin1_code: null,
			lat: 35,
			lng: 135,
			population: null,
			timezone: null
		})
		.executeSync();
}

let userId: number;
let otherUserId: number;
let userSeq = 0;

beforeEach(() => {
	db().deleteFrom(searchDocuments).executeSync();
	db().deleteFrom(places).executeSync();
	db().deleteFrom(placeCategories).executeSync();
	db().deleteFrom(geonamesCities).executeSync();
	db().deleteFrom(users).executeSync();
	setTestEmbedFn(async (text) => hashEmbed(text));
	setEmbeddingsConfig({ ...DEFAULT_EMBEDDINGS_CONFIG });
	userSeq++;
	userId = makeUser(db(), { email: `pl-a-${userSeq}@x.c` }).id;
	otherUserId = makeUser(db(), { email: `pl-b-${userSeq}@x.c` }).id;
});

afterEach(() => {
	setTestEmbedFn(null);
	disableEmbeddings();
	setEmbeddingsConfig({ ...DEFAULT_EMBEDDINGS_CONFIG });
});

test('indexPlace builds a document from name, address, city, category, description, status', async () => {
	makeCity(1857910, 'Kyoto');
	const cat = createPlaceCategory(userId, { name: 'Food & Drink' });
	const place = createPlace(userId, {
		name: 'Nishiki Market Stall',
		categoryId: cat.id,
		cityId: 1857910,
		address: 'Nakagyo Ward, Kyoto',
		description: 'Fresh tofu donuts and pickles',
		status: 'planned'
	});
	await enableEmbeddings();

	await indexPlace(place.id);

	const docs = placeDocs(place.id);
	expect(docs).toHaveLength(1);
	const doc = docs[0];
	expect(doc.entity_type).toBe('place');
	expect(Number(doc.owner_id)).toBe(userId);
	expect(doc.title).toBe('Nishiki Market Stall');
	expect(doc.href).toBe('/places');
	for (const token of [
		'Nakagyo Ward, Kyoto',
		'Kyoto',
		'Food & Drink',
		'Fresh tofu donuts and pickles',
		'planned'
	]) {
		expect(doc.body).toContain(token);
	}
});

test('createPlace indexes the place when embeddings are ready', async () => {
	await enableEmbeddings();
	const place = createPlace(userId, { name: 'Fushimi Inari Shrine' });
	await vi.waitFor(() => expect(placeDocs(place.id)).toHaveLength(1));
	expect(placeDocs(place.id)[0].title).toBe('Fushimi Inari Shrine');
});

test('updatePlace and setPlaceVisited refresh the indexed document', async () => {
	await enableEmbeddings();
	const place = createPlace(userId, { name: 'Arashiyama Grove' });
	await vi.waitFor(() => expect(placeDocs(place.id)).toHaveLength(1));

	updatePlace(place.id, userId, { name: 'Arashiyama Bamboo Grove' });
	await vi.waitFor(() =>
		expect(placeDocs(place.id)[0]?.title).toBe('Arashiyama Bamboo Grove')
	);

	setPlaceVisited(place.id, userId, true);
	await vi.waitFor(() => expect(placeDocs(place.id)[0]?.body).toContain('visited'));
});

test('deletePlace removes the indexed document', async () => {
	await enableEmbeddings();
	const place = createPlace(userId, { name: 'Kinkaku-ji' });
	await vi.waitFor(() => expect(placeDocs(place.id)).toHaveLength(1));

	await deletePlace(place.id, userId);
	await vi.waitFor(() => expect(placeDocs(place.id)).toHaveLength(0));
});

test('place hits are owner-only in semantic search', async () => {
	await enableEmbeddings();
	createPlace(userId, { name: 'Secret Onsen Ryokan', description: 'private mountain bath' });
	createPlace(otherUserId, { name: 'Other User Cafe', description: 'espresso bar' });
	// The hooks are fire-and-forget; wait for both documents to land.
	await vi.waitFor(() => expect(placeDocs()).toHaveLength(2));

	const ownHits = await semanticSearch(userId, 'onsen bath espresso', 10);
	const ownPlaceHits = ownHits.filter((h) => h.entityType === 'place');
	expect(ownPlaceHits.length).toBeGreaterThan(0);
	expect(ownPlaceHits.every((h) => h.ownerId === userId)).toBe(true);

	const otherHits = await semanticSearch(otherUserId, 'onsen bath espresso', 10);
	expect(otherHits.filter((h) => h.entityType === 'place').every((h) => h.ownerId === otherUserId)).toBe(
		true
	);
});

test('renaming a category reindexes linked places with the new name', async () => {
	const cat = createPlaceCategory(userId, { name: 'Old Label' });
	await enableEmbeddings();
	const place = createPlace(userId, { name: 'Gion Corner', categoryId: cat.id });
	await vi.waitFor(() => expect(placeDocs(place.id)[0]?.body).toContain('Old Label'));

	updatePlaceCategory(cat.id, userId, { name: 'New Label' });
	await vi.waitFor(() => expect(placeDocs(place.id)[0]?.body).toContain('New Label'));
	expect(placeDocs(place.id)[0].body).not.toContain('Old Label');
});

test('disabled embeddings make indexing hooks no-ops', async () => {
	expect(embeddingsReady()).toBe(false);
	const cat = createPlaceCategory(userId, { name: 'Nature' });
	const place = createPlace(userId, { name: 'Philosophers Path', categoryId: cat.id });
	updatePlace(place.id, userId, { description: 'canal walk' });
	updatePlaceCategory(cat.id, userId, { name: 'Nature & Outdoor' });
	setPlaceVisited(place.id, userId, true);
	// Let any (unexpected) scheduled work settle.
	await new Promise((resolve) => setTimeout(resolve, 25));
	expect(placeDocs()).toHaveLength(0);

	await deletePlace(place.id, userId);
	await new Promise((resolve) => setTimeout(resolve, 25));
	expect(placeDocs()).toHaveLength(0);
});
