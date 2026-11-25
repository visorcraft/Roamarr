import { error } from '@sveltejs/kit';
export { safeNextPath } from '$lib/safeNextPath';

export function parsePositiveId(value: unknown): number | null {
	const text = typeof value === 'string' ? value : '';
	if (!/^\d+$/.test(text)) return null;
	const id = Number(text);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function parseTripId(params: Record<string, string>) {
	const tripId = parsePositiveId(params.id);
	if (tripId === null) throw error(404, 'Not found');
	return tripId;
}
