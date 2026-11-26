import { error } from '@sveltejs/kit';
export { safeNextPath } from '$lib/safeNextPath';

export function parsePositiveId(value: unknown): number | null {
	const text = typeof value === 'string' ? value : '';
	if (!/^\d+$/.test(text)) return null;
	const id = Number(text);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function requirePositiveId(value: unknown, status = 404, message = 'Not found'): number {
	const id = parsePositiveId(value);
	if (id === null) throw error(status, message);
	return id;
}

export function parseTripId(params: Record<string, string>) {
	return requirePositiveId(params.id);
}
