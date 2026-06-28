import { test, expect, vi, beforeEach, afterAll } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@mongreldb/kit').KitDatabase
}));
vi.mock('../db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
const delivered = vi.hoisted(() => [] as Array<{ uid: number; m: any }>);
vi.mock('../notify', () => ({
	deliver: async (uid: number, m: any) => delivered.push({ uid, m })
}));

beforeEach(() => {
	ctx.kit.deleteFrom(fareWatches).executeSync();
	ctx.kit.deleteFrom(fareProviders).executeSync();
	ctx.kit.deleteFrom(trips).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	delivered.length = 0;
});

import {
	registry,
	runFareChecks,
	createProvider,
	updateProvider,
	deleteProvider,
	testProvider,
	toggleWatch,
	pauseWatch,
	resumeWatch,
	deleteWatch
} from './index';
import { makeKitUser } from '../../../../tests/kitHelpers';
import { createTrip } from '../repositories/tripsRepo';
import { getFareWatchById } from '../repositories/travelDataRepo';
import { users, trips, fareProviders, fareWatches } from '../db/mongrelSchema';
import { eq as kitEq } from '@mongreldb/kit';

test('registry has the stub; key stored encrypted; checks active, skips paused', async () => {
	expect(registry.stub).toBeTruthy();
	const u = makeKitUser({ email: 'fare-a@x.c' });
	const t = createTrip(Number(u.id), { name: 'T' });
	const p = createProvider(Number(u.id), 'stub', 'Work', 'SECRET-KEY', true);
	expect(p.label).toBe('Work');

	const kitRow = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit
		.selectFrom(fareProviders)
		.where(kitEq(fareProviders.id, BigInt(p.id)))
		.executeSync()[0];
	expect(kitRow!.api_key).not.toBe('SECRET-KEY');

	toggleWatch(Number(u.id), t.id, p.id);
	await runFareChecks(new Date());
	const w = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit
		.selectFrom(fareWatches)
		.executeSync()[0];
	expect(w!.last_result_json).toBeTruthy();
	expect(w!.last_checked_at).toBeTruthy();
});

test('user can save multiple accounts per provider', () => {
	const u = makeKitUser({ email: 'fare-multi@x.c' });
	const a = createProvider(Number(u.id), 'stub', 'Personal', 'KEY-A', true);
	const b = createProvider(Number(u.id), 'stub', 'Work', 'KEY-B', true);
	expect(a.id).not.toBe(b.id);
	const rows = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit
		.selectFrom(fareProviders)
		.where(kitEq(fareProviders.user_id, u.id))
		.executeSync();
	expect(rows).toHaveLength(2);
	expect(rows.map((r) => r.label).sort()).toEqual(['Personal', 'Work']);
});

test('updating with a blank apiKey preserves the stored key', () => {
	const u = makeKitUser({ email: 'fare-k@x.c' });
	const p = createProvider(Number(u.id), 'stub', 'Original', 'ORIGINAL-KEY', true);
	updateProvider(Number(u.id), p.id, 'Renamed', '', false); // toggle enabled off without re-entering the key
	const row = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit
		.selectFrom(fareProviders)
		.where(kitEq(fareProviders.id, BigInt(p.id)))
		.executeSync()[0];
	expect(row!.label).toBe('Renamed');
	expect(row!.enabled).toBe(false);
	expect(row!.api_key).not.toBeNull();
});

test('provider mutations are owner-checked', () => {
	const a = makeKitUser({ email: 'fare-own@x.c' });
	const b = makeKitUser({ email: 'fare-other@x.c' });
	const p = createProvider(Number(a.id), 'stub', 'Mine', 'KEY', true);

	expect(() => updateProvider(Number(b.id), p.id, 'Hijacked', 'X', true)).toThrow();
	expect(() => deleteProvider(Number(b.id), p.id)).toThrow();

	deleteProvider(Number(a.id), p.id);
	expect(
		(ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit
			.selectFrom(fareProviders)
			.where(kitEq(fareProviders.id, BigInt(p.id)))
			.executeSync()
	).toHaveLength(0);
});

test('toggleWatch is idempotent — no duplicate watches', () => {
	const u = makeKitUser({ email: 'fare-w@x.c' });
	const t = createTrip(Number(u.id), { name: 'T2' });
	const p = createProvider(Number(u.id), 'stub', 'Primary', 'KEY', true);
	const w1 = toggleWatch(Number(u.id), t.id, p.id);
	const w2 = toggleWatch(Number(u.id), t.id, p.id);
	expect(w2.id).toBe(w1.id);
	expect(
		(ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit
			.selectFrom(fareWatches)
			.where(kitEq(fareWatches.trip_id, BigInt(t.id)))
			.executeSync()
	).toHaveLength(1);
});

test('pauseWatch, resumeWatch and deleteWatch are owner-checked', () => {
	const a = makeKitUser({ email: 'fare-owner@x.c' });
	const b = makeKitUser({ email: 'fare-other2@x.c' });
	const t = createTrip(Number(a.id), { name: 'T3' });
	const p = createProvider(Number(a.id), 'stub', 'Primary', 'KEY', true);
	const w = toggleWatch(Number(a.id), t.id, p.id);

	expect(pauseWatch(Number(a.id), w.id).status).toBe('paused');
	expect(resumeWatch(Number(a.id), w.id).status).toBe('active');

	expect(() => pauseWatch(Number(b.id), w.id)).toThrow();
	expect(() => resumeWatch(Number(b.id), w.id)).toThrow();
	expect(() => deleteWatch(Number(b.id), w.id)).toThrow();

	deleteWatch(Number(a.id), w.id);
	expect(
		(ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit
			.selectFrom(fareWatches)
			.where(kitEq(fareWatches.id, BigInt(w.id)))
			.executeSync()
	).toHaveLength(0);
});

test('runFareChecks skips paused watches and disabled providers', async () => {
	const a = makeKitUser({ email: 'fare-skip-paused@x.c' });
	const t1 = createTrip(Number(a.id), { name: 'Paused' });
	const p1 = createProvider(Number(a.id), 'stub', 'A', 'K1', true);
	const wPaused = toggleWatch(Number(a.id), t1.id, p1.id);
	pauseWatch(Number(a.id), wPaused.id);

	const b = makeKitUser({ email: 'fare-skip-disabled@x.c' });
	const t2 = createTrip(Number(b.id), { name: 'Disabled' });
	const p2 = createProvider(Number(b.id), 'stub', 'B', 'K2', true);
	updateProvider(Number(b.id), p2.id, 'B', '', false); // disable provider without changing key
	const wDisabled = toggleWatch(Number(b.id), t2.id, p2.id);

	await runFareChecks(new Date());

	const r1 = getFareWatchById(wPaused.id);
	const r2 = getFareWatchById(wDisabled.id);
	expect(r1!.lastCheckedAt).toBeNull();
	expect(r2!.lastCheckedAt).toBeNull();
});

test('testProvider returns the stub result for an owned account', async () => {
	const a = makeKitUser({ email: 'fare-test@x.c' });
	const p = createProvider(Number(a.id), 'stub', 'Test', 'KEY', true);
	const res = await testProvider(Number(a.id), p.id);
	expect(res.ok).toBe(true);
	expect(res.summary).toContain('stub provider');
});

test('runFareChecks notifies the provider owner when the summary changes', async () => {
	const u = makeKitUser({ email: 'fare-change@x.c' });
	const t = createTrip(Number(u.id), { name: 'Change' });
	const p = createProvider(Number(u.id), 'stub', 'A', 'K', true);
	toggleWatch(Number(u.id), t.id, p.id);
	(ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit
		.updateTable(fareWatches)
		.set({ last_result_json: JSON.stringify({ ok: true, summary: 'old summary' }) })
		.where(kitEq(fareWatches.trip_id, BigInt(t.id)))
		.executeSync();
	delivered.length = 0;

	const original = registry.stub.check;
	registry.stub.check = async () => ({ ok: true, summary: 'new summary' });
	await runFareChecks(new Date());
	registry.stub.check = original;

	expect(delivered.length).toBe(1);
	expect(delivered[0].uid).toBe(Number(u.id));
	expect(delivered[0].m.title).toBe('Fare watch update');
	expect(delivered[0].m.link).toBe(`/trips/${t.id}`);
});

test('runFareChecks does not notify on the first check', async () => {
	const u = makeKitUser({ email: 'fare-first@x.c' });
	const t = createTrip(Number(u.id), { name: 'First' });
	const p = createProvider(Number(u.id), 'stub', 'A', 'K', true);
	toggleWatch(Number(u.id), t.id, p.id);
	delivered.length = 0;
	await runFareChecks(new Date());
	expect(delivered.length).toBe(0);
});
