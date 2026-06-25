import { error } from '@sveltejs/kit';

export function parseTripId(params: Record<string, string>) {
	const tripId = Number(params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');
	return tripId;
}
