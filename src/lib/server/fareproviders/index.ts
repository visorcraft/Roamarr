import { and, eq } from 'drizzle-orm';
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
	return db
		.insert(fareProviders)
		.values({ userId, providerKey, apiKey: apiKey ? encrypt(apiKey) : null, enabled })
		.onConflictDoUpdate({
			target: [fareProviders.userId, fareProviders.providerKey],
			set: { apiKey: apiKey ? encrypt(apiKey) : null, enabled }
		})
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
	return db
		.insert(fareWatches)
		.values({ tripId, providerId, segmentId: segmentId ?? null, status: 'active' })
		.returning()
		.get();
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
