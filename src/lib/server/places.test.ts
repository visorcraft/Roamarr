import { test, expect, vi, beforeEach, afterAll } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

import {
	ensureDefaultCategories,
	listPlaceCategories,
	createPlaceCategory,
	updatePlaceCategory,
	deletePlaceCategory,
	listPlaces,
	getPlaceById,
	createPlace,
	updatePlace,
	deletePlace,
	setPlaceVisited,
	setPlaceImageAttachment,
	projectPlace,
	DEFAULT_PLACE_CATEGORIES
} from './places';
import { placeCategories, places, users } from './db/mongrelSchema';
import { makeUser } from '../../../tests/helpers';
import { eq } from '@visorcraft/mongreldb-kit';

let userId: number;
let otherUserId: number;

beforeEach(() => {
	ctx.kit.deleteFrom(places).executeSync();
	ctx.kit.deleteFrom(placeCategories).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	userId = makeUser(ctx.kit, { email: 'a@x.c' }).id;
	otherUserId = makeUser(ctx.kit, { email: 'b@x.c' }).id;
});

afterAll(() => {
	ctx.close();
});

// Default categories

test('ensureDefaultCategories seeds the 8 defaults once per user', () => {
	ensureDefaultCategories(userId);
	const cats = listPlaceCategories(userId);
	expect(cats).toHaveLength(DEFAULT_PLACE_CATEGORIES.length);
	expect(new Set(cats.map((c) => c.color)).size).toBe(cats.length);
	// Idempotent: a second ensure does not duplicate.
	ensureDefaultCategories(userId);
	expect(listPlaceCategories(userId)).toHaveLength(DEFAULT_PLACE_CATEGORIES.length);
	// Other users are unaffected.
	expect(listPlaceCategories(otherUserId)).toHaveLength(DEFAULT_PLACE_CATEGORIES.length);
	expect(
		ctx.kit.selectFrom(placeCategories).where(eq(placeCategories.user_id, BigInt(otherUserId))).executeSync()
	).toHaveLength(DEFAULT_PLACE_CATEGORIES.length);
});

// Category CRUD

test('category CRUD is user-scoped', () => {
	const cat = createPlaceCategory(userId, { name: 'Hidden gems', color: '#123abc' });
	expect(cat.color).toBe('#123abc');

	const updated = updatePlaceCategory(cat.id, userId, { name: 'Really hidden', color: '#abcdef' });
	expect(updated?.name).toBe('Really hidden');
	expect(updated?.color).toBe('#abcdef');

	// Another user cannot see, update, or delete it.
	expect(
		ctx.kit
			.selectFrom(placeCategories)
			.where(eq(placeCategories.user_id, BigInt(otherUserId)))
			.executeSync()
	).toHaveLength(0);
	expect(() => updatePlaceCategory(cat.id, otherUserId, { name: 'x' })).toThrow(
		expect.objectContaining({ status: 404 })
	);
	expect(() => deletePlaceCategory(cat.id, otherUserId)).toThrow(
		expect.objectContaining({ status: 404 })
	);

	deletePlaceCategory(cat.id, userId);
	expect(
		ctx.kit.selectFrom(placeCategories).where(eq(placeCategories.id, BigInt(cat.id))).executeSync()
	).toHaveLength(0);
});

test('category validation rejects blank names and bad colors', () => {
	expect(() => createPlaceCategory(userId, { name: '  ' })).toThrow(
		expect.objectContaining({ status: 400 })
	);
	expect(() => createPlaceCategory(userId, { name: 'ok', color: 'red' })).toThrow(
		expect.objectContaining({ status: 400 })
	);
});

test('deleting a category unlinks places instead of removing them', () => {
	const cat = createPlaceCategory(userId, { name: 'Food' });
	const place = createPlace(userId, { name: 'Bistro', categoryId: cat.id });
	deletePlaceCategory(cat.id, userId);
	const after = getPlaceById(place.id, userId);
	expect(after).not.toBeNull();
	expect(after!.categoryId).toBeNull();
});

// Place CRUD

test('create + get round-trips all fields', () => {
	const cat = createPlaceCategory(userId, { name: 'Culture' });
	const place = createPlace(userId, {
		name: 'Louvre',
		categoryId: cat.id,
		address: 'Rue de Rivoli, Paris',
		lat: 48.8606,
		lng: 2.3376,
		durationMin: 180,
		priceCents: 2200,
		description: 'Book ahead',
		status: 'visited',
		favorite: true
	});
	expect(place.status).toBe('visited');
	expect(place.visitedAt).not.toBeNull();

	const got = getPlaceById(place.id, userId)!;
	expect(got.name).toBe('Louvre');
	expect(got.categoryId).toBe(cat.id);
	expect(got.address).toBe('Rue de Rivoli, Paris');
	expect(got.lat).toBeCloseTo(48.8606);
	expect(got.lng).toBeCloseTo(2.3376);
	expect(got.durationMin).toBe(180);
	expect(got.priceCents).toBe(2200);
	expect(got.description).toBe('Book ahead');
	expect(got.favorite).toBe(true);
});

test('places are isolated per user', async () => {
	const place = createPlace(userId, { name: 'Mine' });
	expect(getPlaceById(place.id, otherUserId)).toBeNull();
	expect(listPlaces(otherUserId)).toHaveLength(0);
	expect(() => updatePlace(place.id, otherUserId, { name: 'hijack' })).toThrow(
		expect.objectContaining({ status: 404 })
	);
	await expect(deletePlace(place.id, otherUserId)).rejects.toThrow(
		expect.objectContaining({ status: 404 })
	);
	expect(() => setPlaceVisited(place.id, otherUserId, true)).toThrow(
		expect.objectContaining({ status: 404 })
	);
});

test('create validates required fields and coords', () => {
	expect(() => createPlace(userId, { name: '' })).toThrow(expect.objectContaining({ status: 400 }));
	expect(() => createPlace(userId, { name: 'x', lat: 91, lng: 0 })).toThrow(
		expect.objectContaining({ status: 400 })
	);
	expect(() => createPlace(userId, { name: 'x', lat: 10 })).toThrow(
		expect.objectContaining({ status: 400 })
	);
	expect(() => createPlace(userId, { name: 'x', priceCents: -1 })).toThrow(
		expect.objectContaining({ status: 400 })
	);
});

test('create rejects another user\'s category (assertOwnedRefs)', () => {
	const foreignCat = createPlaceCategory(otherUserId, { name: 'Foreign' });
	expect(() => createPlace(userId, { name: 'x', categoryId: foreignCat.id })).toThrow(
		expect.objectContaining({ status: 404 })
	);
	// Same-user category passes.
	const ownCat = createPlaceCategory(userId, { name: 'Own' });
	expect(createPlace(userId, { name: 'x', categoryId: ownCat.id }).categoryId).toBe(ownCat.id);
});

test('partial update leaves absent keys untouched and supports explicit clears', () => {
	const cat = createPlaceCategory(userId, { name: 'C' });
	const place = createPlace(userId, {
		name: 'Original',
		categoryId: cat.id,
		address: 'Somewhere',
		priceCents: 500,
		favorite: true
	});

	// Rename only: nothing else may change (explicit undefined must not NULL).
	const renamed = updatePlace(place.id, userId, { name: 'Renamed' })!;
	expect(renamed.name).toBe('Renamed');
	expect(renamed.address).toBe('Somewhere');
	expect(renamed.priceCents).toBe(500);
	expect(renamed.categoryId).toBe(cat.id);
	expect(renamed.favorite).toBe(true);

	// Explicit null clears nullable fields.
	const cleared = updatePlace(place.id, userId, { categoryId: null, address: null })!;
	expect(cleared.categoryId).toBeNull();
	expect(cleared.address).toBeNull();
	expect(cleared.name).toBe('Renamed');
});

test('updatePlace rejects another user\'s category', () => {
	const foreignCat = createPlaceCategory(otherUserId, { name: 'Foreign' });
	const place = createPlace(userId, { name: 'x' });
	expect(() => updatePlace(place.id, userId, { categoryId: foreignCat.id })).toThrow(
		expect.objectContaining({ status: 404 })
	);
});

test('setPlaceVisited toggles status and visited_at', () => {
	const place = createPlace(userId, { name: 'Trail' });
	expect(place.status).toBe('planned');
	expect(place.visitedAt).toBeNull();

	const visited = setPlaceVisited(place.id, userId, true);
	expect(visited.status).toBe('visited');
	expect(visited.visitedAt).not.toBeNull();

	const planned = setPlaceVisited(place.id, userId, false);
	expect(planned.status).toBe('planned');
	expect(planned.visitedAt).toBeNull();
});

test('listPlaces filters by category, status, favorite, and search', () => {
	const catA = createPlaceCategory(userId, { name: 'A' });
	const catB = createPlaceCategory(userId, { name: 'B' });
	createPlace(userId, { name: 'Alpha cafe', categoryId: catA.id, favorite: true });
	createPlace(userId, { name: 'Beta museum', categoryId: catB.id, status: 'visited' });
	createPlace(userId, { name: 'Gamma park' });

	expect(listPlaces(userId)).toHaveLength(3);
	expect(listPlaces(userId, { categoryId: catA.id })).toHaveLength(1);
	expect(listPlaces(userId, { status: 'visited' })).toHaveLength(1);
	expect(listPlaces(userId, { favorite: true })).toHaveLength(1);
	expect(listPlaces(userId, { search: 'museum' })).toHaveLength(1);
	expect(listPlaces(userId, { search: 'a' }).length).toBeGreaterThanOrEqual(2);
});

test('projectPlace derives hasImage/hasGpx from the attachment links', () => {
	const place = createPlace(userId, { name: 'Trailhead' });
	expect(projectPlace(place).hasImage).toBe(false);
	expect(projectPlace(place).hasGpx).toBe(false);

	const withImage = setPlaceImageAttachment(place.id, userId, 42);
	expect(projectPlace(withImage).hasImage).toBe(true);
	expect(projectPlace(withImage).hasGpx).toBe(false);

	ctx.kit
		.updateTable(places)
		.set({ gpx_attachment_id: 43n })
		.where(eq(places.id, BigInt(place.id)))
		.executeSync();
	const withGpx = getPlaceById(place.id, userId)!;
	expect(projectPlace(withGpx).hasImage).toBe(true);
	expect(projectPlace(withGpx).hasGpx).toBe(true);
});
