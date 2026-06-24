import { and, eq, isNull } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from '../db';
import { fareProviders, fareWatches } from '../db/schema';
import { encrypt, decrypt } from '../crypto';
import { requireOwnedTrip, assertOwnedRefs } from '../ownership';
import { stub } from './stub';

type FareResult = { ok: boolean; summary: string; raw?: unknown };

export interface FareProvider {
	key: string;
	label: string;
	check(watch: typeof fareWatches.$inferSelect, apiKey: string): Promise<FareResult>;
}

export const registry: Record<string, FareProvider> = { [stub.key]: stub };

export function createProvider(
	userId: number,
	providerKey: string,
	label: string,
	apiKey: string,
	enabled: boolean
) {
	if (!registry[providerKey]) throw error(400, 'Unknown provider');
	return db
		.insert(fareProviders)
		.values({
			userId,
			providerKey,
			label: label.trim(),
			apiKey: apiKey ? encrypt(apiKey) : null,
			enabled
		})
		.returning()
		.get();
}

function requireOwnedProvider(userId: number, providerId: number) {
	const p = db
		.select()
		.from(fareProviders)
		.where(and(eq(fareProviders.id, providerId), eq(fareProviders.userId, userId)))
		.get();
	if (!p) throw error(404, 'Not found');
	return p;
}

export function updateProvider(
	userId: number,
	providerId: number,
	label: string,
	apiKey: string,
	enabled: boolean
) {
	requireOwnedProvider(userId, providerId);
	const set: Partial<typeof fareProviders.$inferInsert> = {
		label: label.trim(),
		enabled
	};
	if (apiKey) set.apiKey = encrypt(apiKey);
	return db
		.update(fareProviders)
		.set(set)
		.where(and(eq(fareProviders.id, providerId), eq(fareProviders.userId, userId)))
		.returning()
		.get();
}

export function deleteProvider(userId: number, providerId: number) {
	requireOwnedProvider(userId, providerId);
	db.delete(fareProviders)
		.where(and(eq(fareProviders.id, providerId), eq(fareProviders.userId, userId)))
		.run();
}

export async function testProvider(userId: number, providerId: number): Promise<FareResult> {
	const p = requireOwnedProvider(userId, providerId);
	const provider = registry[p.providerKey];
	if (!provider) throw error(400, 'Unknown provider');
	const dummyWatch = {
		id: 0,
		tripId: 0,
		segmentId: null,
		providerId: p.id,
		status: 'active',
		lastCheckedAt: null,
		lastResultJson: null,
		createdAt: new Date().toISOString()
	} as typeof fareWatches.$inferSelect;
	return provider.check(dummyWatch, p.apiKey ? decrypt(p.apiKey) : '');
}

export function toggleWatch(
	userId: number,
	tripId: number,
	providerId: number,
	segmentId?: number
) {
	requireOwnedTrip(userId, tripId);
	assertOwnedRefs(userId, { providerId, segmentId: segmentId ?? null });
	const sid = segmentId ?? null;
	// Idempotent: re-enabling an already-watched (trip, provider, segment) returns the
	// existing row instead of stacking duplicate watches (and duplicate provider calls).
	const existing = db
		.select()
		.from(fareWatches)
		.where(
			and(
				eq(fareWatches.tripId, tripId),
				eq(fareWatches.providerId, providerId),
				sid == null ? isNull(fareWatches.segmentId) : eq(fareWatches.segmentId, sid)
			)
		)
		.get();
	if (existing) return existing;
	return db
		.insert(fareWatches)
		.values({ tripId, providerId, segmentId: sid, status: 'active' })
		.returning()
		.get();
}

function requireOwnedWatch(userId: number, watchId: number) {
	const w = db.select().from(fareWatches).where(eq(fareWatches.id, watchId)).get();
	if (!w) throw error(404, 'Not found');
	requireOwnedTrip(userId, w.tripId);
	assertOwnedRefs(userId, { providerId: w.providerId });
	return w;
}

export function pauseWatch(userId: number, watchId: number) {
	requireOwnedWatch(userId, watchId);
	return db
		.update(fareWatches)
		.set({ status: 'paused' })
		.where(eq(fareWatches.id, watchId))
		.returning()
		.get();
}

export function resumeWatch(userId: number, watchId: number) {
	requireOwnedWatch(userId, watchId);
	return db
		.update(fareWatches)
		.set({ status: 'active' })
		.where(eq(fareWatches.id, watchId))
		.returning()
		.get();
}

export function deleteWatch(userId: number, watchId: number) {
	requireOwnedWatch(userId, watchId);
	db.delete(fareWatches).where(eq(fareWatches.id, watchId)).run();
}

export async function checkWatch(userId: number, watchId: number): Promise<FareResult> {
	const w = requireOwnedWatch(userId, watchId);
	const p = db.select().from(fareProviders).where(eq(fareProviders.id, w.providerId)).get();
	if (!p || !p.enabled) throw error(400, 'Provider not found or disabled');
	const provider = registry[p.providerKey];
	if (!provider) throw error(400, 'Unknown provider');
	const now = new Date();
	let res: FareResult;
	try {
		res = await provider.check(w, p.apiKey ? decrypt(p.apiKey) : '');
	} catch (e) {
		res = { ok: false, summary: String(e) };
	}
	db.update(fareWatches)
		.set({ lastResultJson: JSON.stringify(res), lastCheckedAt: now.toISOString() })
		.where(eq(fareWatches.id, w.id))
		.run();
	return res;
}

export async function runFareChecks(now: Date) {
	const rows = db
		.select()
		.from(fareWatches)
		.innerJoin(fareProviders, eq(fareWatches.providerId, fareProviders.id))
		.where(and(eq(fareWatches.status, 'active'), eq(fareProviders.enabled, true)))
		.all();
	for (const row of rows) {
		const w = row.fare_watches;
		const p = row.fare_providers;
		const provider = registry[p.providerKey];
		if (!provider) continue;
		try {
			const res = await provider.check(w, p.apiKey ? decrypt(p.apiKey) : '');
			db.update(fareWatches)
				.set({ lastResultJson: JSON.stringify(res), lastCheckedAt: now.toISOString() })
				.where(eq(fareWatches.id, w.id))
				.run();
		} catch (e) {
			db.update(fareWatches)
				.set({
					lastResultJson: JSON.stringify({ ok: false, summary: String(e) }),
					lastCheckedAt: now.toISOString()
				})
				.where(eq(fareWatches.id, w.id))
				.run();
		}
	}
}
