import { and, eq, isNull } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from '../db';
import { fareProviders, fareWatches } from '../db/schema';
import { encrypt, decrypt } from '../crypto';
import { requireOwnedTrip, assertOwnedRefs } from '../ownership';
import { stub } from './stub';

export type FareResult = { ok: boolean; summary: string; raw?: unknown };

export interface FareProvider {
	key: string;
	label: string;
	check(watch: typeof fareWatches.$inferSelect, apiKey: string): Promise<FareResult>;
}

export const registry: Record<string, FareProvider> = { [stub.key]: stub };

export function saveProvider(userId: number, providerKey: string, apiKey: string, enabled: boolean) {
	if (!registry[providerKey]) throw error(400, 'Unknown provider');
	// A blank apiKey means "keep the stored key" — the settings form never echoes the
	// secret back, so an unrelated save (e.g. just toggling `enabled`) must not wipe it.
	// Mirrors the smtp_pass preserve pattern.
	const enc = apiKey ? encrypt(apiKey) : null;
	const set: Partial<typeof fareProviders.$inferInsert> = { enabled };
	if (apiKey) set.apiKey = enc;
	return db
		.insert(fareProviders)
		.values({ userId, providerKey, apiKey: enc, enabled })
		.onConflictDoUpdate({ target: [fareProviders.userId, fareProviders.providerKey], set })
		.returning()
		.get();
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
