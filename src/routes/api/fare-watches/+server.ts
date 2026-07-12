import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { listFareProvidersForUser, listFareWatchesForUser } from '$lib/server/repositories/travelDataRepo';
import { listTripsForUser } from '$lib/server/repositories/tripsRepo';
import { listSegmentsForTrips } from '$lib/server/repositories/segmentsRepo';
import { checkWatch, deleteWatch, pauseWatch, resumeWatch, toggleWatch } from '$lib/server/fareproviders';

function positiveId(value: unknown, name: string): number {
	const id = Number(value);
	if (!Number.isSafeInteger(id) || id < 1) throw error(400, `${name} must be a positive integer`);
	return id;
}

export const GET: RequestHandler = ({ locals }) => {
	const user = requireUser(locals);
	const trips = listTripsForUser(user.id);
	return json({
		rows: listFareWatchesForUser(user.id).map((watch) => ({
			id: watch.id, tripId: watch.tripId, providerId: watch.providerId, segmentId: watch.segmentId,
			status: watch.status, lastCheckedAt: watch.lastCheckedAt,
			summary: watch.lastResultJson ? (() => { try { return JSON.parse(watch.lastResultJson).summary ?? null; } catch { return null; } })() : null
		})),
		providers: listFareProvidersForUser(user.id).map(({ id, providerKey, label, enabled }) => ({ id, providerKey, label, enabled }))
		, trips: trips.map(({ id, name }) => ({ id, name })),
		segments: listSegmentsForTrips(trips.map(({ id }) => id)).map(({ id, tripId, title }) => ({ id, tripId, title }))
	});
};

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	const user = requireUser(locals);
	const body = await request.json().catch(() => { throw error(400, 'Invalid JSON'); }) as Record<string, unknown>;
	const action = String(body.action ?? '');
	if (action === 'create') {
		const watch = toggleWatch(user.id, positiveId(body.tripId, 'tripId'), positiveId(body.providerId, 'providerId'), body.segmentId == null ? undefined : positiveId(body.segmentId, 'segmentId'));
		return json(watch, { status: 201 });
	}
	const watchId = positiveId(body.watchId, 'watchId');
	if (action === 'pause') return json(pauseWatch(user.id, watchId));
	if (action === 'resume') return json(resumeWatch(user.id, watchId));
	if (action === 'delete') { deleteWatch(user.id, watchId); return new Response(null, { status: 204 }); }
	if (action === 'check') {
		const limit = checkRateLimit(getClientAddress(), 'fare:check');
		if (!limit.allowed) throw error(429, 'Too many requests');
		return json(await checkWatch(user.id, watchId));
	}
	throw error(400, 'Unknown action');
};
