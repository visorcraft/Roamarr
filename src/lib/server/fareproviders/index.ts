import { error } from '@sveltejs/kit';
import {
	createFareProvider,
	updateFareProvider,
	deleteFareProvider,
	getFareProviderById,
	getFareProviderByIdAndUser,
	getFareWatchById,
	getFareWatchByTripAndProvider,
	createFareWatch,
	updateFareWatch,
	deleteFareWatch,
	listActiveFareWatches,
	touchFareWatch,
	type FareWatch,
	type FareProviderAccount
} from '../repositories/travelDataRepo';
import { deliver } from '../notify';
import { requireOwnedTrip, assertOwnedRefs } from '../ownership';
import { stub } from './stub';

type FareResult = { ok: boolean; summary: string; raw?: unknown };

export interface FareProvider {
	key: string;
	label: string;
	check(watch: FareWatch, apiKey: string): Promise<FareResult>;
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
	return createFareProvider({
		userId,
		providerKey,
		label: label.trim(),
		apiKey: apiKey || null,
		enabled
	});
}

function requireOwnedProvider(userId: number, providerId: number): FareProviderAccount {
	const p = getFareProviderByIdAndUser(providerId, userId);
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
	const updated = updateFareProvider(providerId, {
		label: label.trim(),
		apiKey,
		enabled
	});
	if (!updated) throw error(404, 'Not found');
	return updated;
}

export function deleteProvider(userId: number, providerId: number) {
	requireOwnedProvider(userId, providerId);
	deleteFareProvider(providerId);
}

export async function testProvider(userId: number, providerId: number): Promise<FareResult> {
	const p = requireOwnedProvider(userId, providerId);
	const provider = registry[p.providerKey];
	if (!provider) throw error(400, 'Unknown provider');
	const dummyWatch: FareWatch = {
		id: 0,
		tripId: 0,
		segmentId: null,
		providerId: p.id,
		status: 'active',
		lastCheckedAt: null,
		lastResultJson: null,
		createdAt: new Date().toISOString()
	};
	return provider.check(dummyWatch, p.apiKey ?? '');
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
	const existing = getFareWatchByTripAndProvider(tripId, providerId, sid);
	if (existing) return existing;
	return createFareWatch({ tripId, providerId, segmentId: sid, status: 'active' });
}

function requireOwnedWatch(userId: number, watchId: number): FareWatch {
	const w = getFareWatchById(watchId);
	if (!w) throw error(404, 'Not found');
	requireOwnedTrip(userId, w.tripId);
	assertOwnedRefs(userId, { providerId: w.providerId });
	return w;
}

export function pauseWatch(userId: number, watchId: number) {
	requireOwnedWatch(userId, watchId);
	const updated = updateFareWatch(watchId, { status: 'paused' });
	if (!updated) throw error(404, 'Not found');
	return updated;
}

export function resumeWatch(userId: number, watchId: number) {
	requireOwnedWatch(userId, watchId);
	const updated = updateFareWatch(watchId, { status: 'active' });
	if (!updated) throw error(404, 'Not found');
	return updated;
}

export function deleteWatch(userId: number, watchId: number) {
	requireOwnedWatch(userId, watchId);
	deleteFareWatch(watchId);
}

function previousSummary(watch: FareWatch): string | null {
	if (!watch.lastResultJson) return null;
	try {
		return (JSON.parse(watch.lastResultJson) as FareResult).summary ?? null;
	} catch {
		return null;
	}
}

async function applyResult(
	watch: FareWatch,
	providerRow: FareProviderAccount,
	result: FareResult,
	now: Date
) {
	const prior = previousSummary(watch);
	updateFareWatch(watch.id, {
		lastResultJson: JSON.stringify(result),
		lastCheckedAt: now.toISOString()
	});
	if (prior !== null && result.summary !== prior) {
		await deliver(providerRow.userId, {
			title: 'Fare watch update',
			body: 'A fare watch result changed.',
			link: `/trips/${watch.tripId}`
		});
	}
}

export async function checkWatch(userId: number, watchId: number): Promise<FareResult> {
	const w = requireOwnedWatch(userId, watchId);
	const p = getFareProviderById(w.providerId);
	if (!p || !p.enabled) throw error(400, 'Provider not found or disabled');
	const provider = registry[p.providerKey];
	if (!provider) throw error(400, 'Unknown provider');
	const now = new Date();
	let res: FareResult;
	try {
		res = await provider.check(w, p.apiKey ?? '');
	} catch (e) {
		res = { ok: false, summary: String(e) };
	}
	await applyResult(w, p, res, now);
	return res;
}

export async function runFareChecks(now: Date) {
	const rows = listActiveFareWatches();
	for (const row of rows) {
		const w = row;
		const p = row.provider;
		const provider = registry[p.providerKey];
		if (!provider) continue;
		try {
			const res = await provider.check(w, p.apiKey ?? '');
			await applyResult(w, p, res, now);
		} catch (e) {
			const res = { ok: false, summary: String(e) };
			await applyResult(w, p, res, now);
		}
	}
}
