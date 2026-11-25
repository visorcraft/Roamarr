import { test, expect, vi, beforeEach, afterAll } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

import { fareProviders, fareWatches, segments, trips, users } from '$lib/server/db/mongrelSchema';
import { createTrip } from '$lib/server/repositories/tripsRepo';
import {
	createFareProvider,
	createFareWatch,
	getFareWatchById
} from '$lib/server/repositories/travelDataRepo';
import { currentTripRev, subscribeUser } from '../eventBus';
import { makeKitUser } from '../../../../tests/kitHelpers';
import { makeSegment } from '../../../../tests/helpers';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { toggleWatch, pauseWatch, resumeWatch, deleteWatch, updateProvider } from './index';

beforeEach(() => {
	ctx.kit.deleteFrom(fareWatches).executeSync();
	ctx.kit.deleteFrom(fareProviders).executeSync();
	ctx.kit.deleteFrom(segments).executeSync();
	ctx.kit.deleteFrom(trips).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
});

afterAll(() => {
	ctx.close();
});

function captureTripEvents(userId: number) {
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(userId, (e) => events.push(e as never));
	if (!unsubscribe) throw new Error('subscribeUser returned null');
	return { events, unsubscribe };
}

function setupOwnerTrip() {
	const owner = makeKitUser();
	const ownerId = Number(owner.id);
	const trip = createTrip(ownerId, { name: 'T' });
	const provider = createFareProvider({
		userId: ownerId,
		providerKey: 'stub',
		label: 'Work',
		apiKey: null,
		enabled: true
	});
	return { ownerId, trip, provider };
}

test('toggleWatch creates a watch and publishes trip-changed once', () => {
	const { ownerId, trip, provider } = setupOwnerTrip();
	const { events, unsubscribe } = captureTripEvents(ownerId);
	const before = currentTripRev(trip.id);

	const w = toggleWatch(ownerId, trip.id, provider.id);

	expect(w.id).toBeGreaterThan(0);
	expect(w.tripId).toBe(trip.id);
	expect(w.providerId).toBe(provider.id);
	expect(w.status).toBe('active');
	expect(currentTripRev(trip.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: trip.id });
	unsubscribe();
});

test('toggleWatch is idempotent: second call returns the same watch and publishes nothing', () => {
	const { ownerId, trip, provider } = setupOwnerTrip();
	const { events, unsubscribe } = captureTripEvents(ownerId);
	const before = currentTripRev(trip.id);

	const first = toggleWatch(ownerId, trip.id, provider.id);
	expect(currentTripRev(trip.id) - before).toBe(1);
	expect(events).toHaveLength(1);

	const second = toggleWatch(ownerId, trip.id, provider.id);
	expect(second.id).toBe(first.id);
	expect(currentTripRev(trip.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	unsubscribe();
});

test('pauseWatch on an active watch sets status paused and publishes once', () => {
	const { ownerId, trip, provider } = setupOwnerTrip();
	const w = createFareWatch({ tripId: trip.id, providerId: provider.id });
	expect(w.status).toBe('active');

	const { events, unsubscribe } = captureTripEvents(ownerId);
	const before = currentTripRev(trip.id);

	const updated = pauseWatch(ownerId, w.id);

	expect(updated.status).toBe('paused');
	expect(getFareWatchById(w.id)!.status).toBe('paused');
	expect(currentTripRev(trip.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: trip.id });
	unsubscribe();
});

test('pauseWatch on an already-paused watch is a no-op and publishes nothing', () => {
	const { ownerId, trip, provider } = setupOwnerTrip();
	const w = createFareWatch({ tripId: trip.id, providerId: provider.id, status: 'paused' });

	const { events, unsubscribe } = captureTripEvents(ownerId);
	const before = currentTripRev(trip.id);

	const result = pauseWatch(ownerId, w.id);

	expect(result.id).toBe(w.id);
	expect(result.status).toBe('paused');
	expect(currentTripRev(trip.id) - before).toBe(0);
	expect(events).toHaveLength(0);
	unsubscribe();
});

test('resumeWatch on a paused watch sets status active and publishes once', () => {
	const { ownerId, trip, provider } = setupOwnerTrip();
	const w = createFareWatch({ tripId: trip.id, providerId: provider.id, status: 'paused' });

	const { events, unsubscribe } = captureTripEvents(ownerId);
	const before = currentTripRev(trip.id);

	const updated = resumeWatch(ownerId, w.id);

	expect(updated.status).toBe('active');
	expect(getFareWatchById(w.id)!.status).toBe('active');
	expect(currentTripRev(trip.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: trip.id });
	unsubscribe();
});

test('resumeWatch on an already-active watch is a no-op and publishes nothing', () => {
	const { ownerId, trip, provider } = setupOwnerTrip();
	const w = createFareWatch({ tripId: trip.id, providerId: provider.id });

	const { events, unsubscribe } = captureTripEvents(ownerId);
	const before = currentTripRev(trip.id);

	const result = resumeWatch(ownerId, w.id);

	expect(result.id).toBe(w.id);
	expect(result.status).toBe('active');
	expect(currentTripRev(trip.id) - before).toBe(0);
	expect(events).toHaveLength(0);
	unsubscribe();
});

test('deleteWatch publishes once with the trip id and removes the watch', () => {
	const { ownerId, trip, provider } = setupOwnerTrip();
	const w = createFareWatch({ tripId: trip.id, providerId: provider.id });

	const { events, unsubscribe } = captureTripEvents(ownerId);
	const before = currentTripRev(trip.id);

	deleteWatch(ownerId, w.id);

	expect(getFareWatchById(w.id)).toBeNull();
	expect(currentTripRev(trip.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: trip.id });
	unsubscribe();
});

test('ownership guard: non-owner pause/resume/delete throw and publish nothing', () => {
	const { ownerId, trip, provider } = setupOwnerTrip();
	const intruder = makeKitUser();
	const intruderId = Number(intruder.id);
	const w = createFareWatch({ tripId: trip.id, providerId: provider.id });

	const { events, unsubscribe } = captureTripEvents(ownerId);
	const before = currentTripRev(trip.id);

	expect(() => pauseWatch(intruderId, w.id)).toThrow();
	expect(() => resumeWatch(intruderId, w.id)).toThrow();
	expect(() => deleteWatch(intruderId, w.id)).toThrow();

	expect(currentTripRev(trip.id) - before).toBe(0);
	expect(events).toHaveLength(0);
	expect(getFareWatchById(w.id)).not.toBeNull();
	unsubscribe();
});

test('toggleWatch with a segment from a different trip throws and publishes nothing', () => {
	const { ownerId, trip, provider } = setupOwnerTrip();
	const otherTrip = createTrip(ownerId, { name: 'Other' });
	const otherSegment = makeSegment(ctx.kit, otherTrip.id);

	const { events, unsubscribe } = captureTripEvents(ownerId);
	const before = currentTripRev(trip.id);

	expect(() => toggleWatch(ownerId, trip.id, provider.id, otherSegment.id)).toThrow();

	expect(currentTripRev(trip.id) - before).toBe(0);
	expect(events).toHaveLength(0);
	unsubscribe();
});

test('updateProvider omits enabled and keeps the stored flag', () => {
	const { ownerId, provider } = setupOwnerTrip();

	const result = updateProvider(ownerId, provider.id, 'Renamed', '');
	expect(result).toMatchObject({ label: 'Renamed', enabled: true });

	const row = ctx.kit.selectFrom(fareProviders).where(kitEq(fareProviders.id, BigInt(provider.id))).executeSync()[0]!;
	expect(row.label).toBe('Renamed');
	expect(row.enabled).toBe(true);
});

test('updateProvider with a null label keeps the stored label', () => {
	const { ownerId, provider } = setupOwnerTrip();

	const result = updateProvider(ownerId, provider.id, null, '', false);
	expect(result).toMatchObject({ label: 'Work', enabled: false });
});

test('updateProvider rejects an invalid label without mutating the row', () => {
	const { ownerId, provider } = setupOwnerTrip();

	expect(() => updateProvider(ownerId, provider.id, '   ', '', false)).toThrow(/Label is required/);

	const row = ctx.kit.selectFrom(fareProviders).where(kitEq(fareProviders.id, BigInt(provider.id))).executeSync()[0]!;
	expect(row.label).toBe('Work');
	expect(row.enabled).toBe(true);
});

test('updateProvider enforces ownership', () => {
	const { provider } = setupOwnerTrip();
	const intruder = makeKitUser();
	const intruderId = Number(intruder.id);

	expect(() => updateProvider(intruderId, provider.id, null, '', false)).toThrow();

	const row = ctx.kit.selectFrom(fareProviders).where(kitEq(fareProviders.id, BigInt(provider.id))).executeSync()[0]!;
	expect(row.enabled).toBe(true);
});
