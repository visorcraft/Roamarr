import { test, expect, vi, beforeEach, afterAll } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@mongreldb/kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

beforeEach(() => {
	ctx.kit.deleteFrom(fareWatches).executeSync();
	ctx.kit.deleteFrom(fareProviders).executeSync();
	ctx.kit.deleteFrom(trips).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
});

afterAll(() => {
	ctx.close();
});

import { actions } from './+page.server';
import { makeKitUser } from '../../../../../tests/kitHelpers';
import { createTrip } from '$lib/server/repositories/tripsRepo';
import { createFareProvider, createFareWatch, getFareWatchById } from '$lib/server/repositories/travelDataRepo';
import { fareProviders, fareWatches, trips, users } from '$lib/server/db/mongrelSchema';
import { eq as kitEq } from '@mongreldb/kit';

function event(user: { id: number }, body: FormData, tripId: number) {
	return {
		locals: { user } as App.Locals,
		request: { formData: async () => body } as Request,
		params: { id: String(tripId) }
	} as any;
}

test('enable action creates a watch with the chosen provider account', async () => {
	const a = makeKitUser({ email: 'fw@x.c' });
	const t = createTrip(Number(a.id), { name: 'T' });
	const p = createFareProvider({ userId: Number(a.id), providerKey: 'stub', label: 'Work', apiKey: null, enabled: true });

	const body = new FormData();
	body.set('providerId', String(p.id));
	await expect(actions.enable(event({ id: Number(a.id) }, body, t.id))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const w = ctx.kit
		.selectFrom(fareWatches)
		.where(kitEq(fareWatches.trip_id, BigInt(t.id)))
		.executeSync()[0];
	expect(Number(w!.provider_id)).toBe(p.id);
	expect(w!.status).toBe('active');
});

test('enable action is ownership-checked', async () => {
	const a = makeKitUser({ email: 'fw-a@x.c' });
	const b = makeKitUser({ email: 'fw-b@x.c' });
	const t = createTrip(Number(a.id), { name: 'T' });
	const p = createFareProvider({ userId: Number(a.id), providerKey: 'stub', label: 'Work', apiKey: null, enabled: true });

	const body = new FormData();
	body.set('providerId', String(p.id));
	await expect(actions.enable(event({ id: Number(b.id) }, body, t.id))).rejects.toThrow();
});

test('pause, resume and delete actions are ownership-checked', async () => {
	const a = makeKitUser({ email: 'fw-owner@x.c' });
	const b = makeKitUser({ email: 'fw-intruder@x.c' });
	const t = createTrip(Number(a.id), { name: 'T' });
	const p = createFareProvider({ userId: Number(a.id), providerKey: 'stub', label: 'Work', apiKey: null, enabled: true });
	const w = createFareWatch({ tripId: t.id, providerId: p.id });

	const pauseBody = new FormData();
	pauseBody.set('watchId', String(w.id));
	await expect(actions.pause(event({ id: Number(a.id) }, pauseBody, t.id))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);
	expect(getFareWatchById(w.id)!.status).toBe('paused');

	const resumeBody = new FormData();
	resumeBody.set('watchId', String(w.id));
	await expect(actions.resume(event({ id: Number(a.id) }, resumeBody, t.id))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);
	expect(getFareWatchById(w.id)!.status).toBe('active');

	await expect(actions.pause(event({ id: Number(b.id) }, pauseBody, t.id))).rejects.toThrow();
	await expect(actions.resume(event({ id: Number(b.id) }, resumeBody, t.id))).rejects.toThrow();
	await expect(actions.delete(event({ id: Number(b.id) }, pauseBody, t.id))).rejects.toThrow();

	const deleteBody = new FormData();
	deleteBody.set('watchId', String(w.id));
	await expect(actions.delete(event({ id: Number(a.id) }, deleteBody, t.id))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);
	expect(getFareWatchById(w.id)).toBeNull();
});
