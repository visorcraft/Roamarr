import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase
}));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { assertOwnedRefs } from './ownership';
import { addDocument, updateDocument } from './travelDocuments';
import { listTravelDocuments, getTravelDocumentById } from './repositories/profileRepo';
import { users, trips, tripCompanions, travelDocuments, reminders } from './db/mongrelSchema';
import { makeUser, makeTrip, makeCompanion } from '../../../tests/helpers';

function kitDb(): import('@visorcraft/mongreldb-kit').KitDatabase {
	return ctx.kit;
}

function makeTestUser(email: string) {
	return makeUser(kitDb(), { email });
}

function makeTestTrip(ownerId: number, name: string) {
	return makeTrip(kitDb(), ownerId, { name });
}

function makeTestCompanion(tripId: number, name: string) {
	return makeCompanion(kitDb(), tripId, { name });
}

beforeEach(() => {
	const kit = kitDb();
	kit.deleteFrom(reminders).executeSync();
	kit.deleteFrom(travelDocuments).executeSync();
	kit.deleteFrom(tripCompanions).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('assertOwnedRefs accepts an own companion on an owned trip', () => {
	const u = makeTestUser('refs-owner@x.c');
	const trip = makeTestTrip(u.id, 'Own trip');
	const companion = makeTestCompanion(trip.id, 'Alex');
	expect(() => assertOwnedRefs(u.id, { companionId: companion.id })).not.toThrow();
});

test('assertOwnedRefs throws 404 for a nonexistent companion', () => {
	const u = makeTestUser('refs-missing@x.c');
	expect(() => assertOwnedRefs(u.id, { companionId: 999999 })).toThrow(expect.objectContaining({ status: 404 }));
});

test('assertOwnedRefs throws 404 for a companion on another user\'s trip', () => {
	const owner = makeTestUser('refs-owner-b@x.c');
	const other = makeTestUser('refs-other-b@x.c');
	const trip = makeTestTrip(owner.id, 'Owner trip');
	const companion = makeTestCompanion(trip.id, 'Riley');
	expect(() => assertOwnedRefs(other.id, { companionId: companion.id })).toThrow(expect.objectContaining({ status: 404 }));
});

test('assertOwnedRefs ignores a null companionId', () => {
	const u = makeTestUser('refs-null@x.c');
	expect(() => assertOwnedRefs(u.id, { companionId: null })).not.toThrow();
});

test('addDocument stores an owned companion link', () => {
	const u = makeTestUser('add-own@x.c');
	const trip = makeTestTrip(u.id, 'Paris');
	const companion = makeTestCompanion(trip.id, 'Alex');

	const doc = addDocument(u.id, {
		type: 'passport',
		number: 'P1234567',
		companionId: companion.id
	});

	expect(doc.companionId).toBe(companion.id);
	const listed = listTravelDocuments(u.id);
	expect(listed).toHaveLength(1);
	expect(listed[0]!.companionId).toBe(companion.id);
});

test('addDocument throws 404 and writes nothing for a nonexistent companion', () => {
	const u = makeTestUser('add-missing@x.c');
	expect(() =>
		addDocument(u.id, { type: 'passport', companionId: 999999 })
	).toThrow(expect.objectContaining({ status: 404 }));
	expect(listTravelDocuments(u.id)).toHaveLength(0);
});

test('addDocument throws 404 and writes nothing for another user\'s companion', () => {
	const owner = makeTestUser('add-owner@x.c');
	const other = makeTestUser('add-other@x.c');
	const trip = makeTestTrip(owner.id, 'Rome');
	const companion = makeTestCompanion(trip.id, 'Quinn');

	expect(() =>
		addDocument(other.id, { type: 'passport', companionId: companion.id })
	).toThrow(expect.objectContaining({ status: 404 }));
	expect(listTravelDocuments(other.id)).toHaveLength(0);
});

test('updateDocument links a document to an owned companion', () => {
	const u = makeTestUser('upd-own@x.c');
	const trip = makeTestTrip(u.id, 'Lisbon');
	const companion = makeTestCompanion(trip.id, 'Sam');
	const doc = addDocument(u.id, { type: 'passport' });

	const updated = updateDocument(u.id, doc.id, { type: 'passport', companionId: companion.id });

	expect(updated.companionId).toBe(companion.id);
	expect(getTravelDocumentById(doc.id, u.id)!.companionId).toBe(companion.id);
});

test('updateDocument throws 404 and keeps the stored companion for another user\'s companion', () => {
	const owner = makeTestUser('upd-owner@x.c');
	const other = makeTestUser('upd-other@x.c');
	const trip = makeTestTrip(owner.id, 'Tokyo');
	const companion = makeTestCompanion(trip.id, 'Lee');
	const doc = addDocument(owner.id, { type: 'passport', companionId: companion.id });
	const storedBefore = getTravelDocumentById(doc.id, owner.id)!.companionId;

	const otherTrip = makeTestTrip(other.id, 'Other trip');
	const otherCompanion = makeTestCompanion(otherTrip.id, 'Max');
	expect(() =>
		updateDocument(owner.id, doc.id, { type: 'passport', companionId: otherCompanion.id })
	).toThrow(expect.objectContaining({ status: 404 }));
	expect(getTravelDocumentById(doc.id, owner.id)!.companionId).toBe(storedBefore);
});

test('updateDocument clears the companion link when companionId is null', () => {
	const u = makeTestUser('upd-null@x.c');
	const trip = makeTestTrip(u.id, 'Cairo');
	const companion = makeTestCompanion(trip.id, 'Pat');
	const doc = addDocument(u.id, { type: 'passport', companionId: companion.id });

	const updated = updateDocument(u.id, doc.id, { type: 'passport', companionId: null });

	expect(updated.companionId).toBeNull();
	expect(getTravelDocumentById(doc.id, u.id)!.companionId).toBeNull();
});
