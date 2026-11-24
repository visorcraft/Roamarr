import { error } from '@sveltejs/kit';

export function parseTripId(params: Record<string, string>) {
	const tripId = Number(params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');
	return tripId;
}

/**
 * Post-login redirect target. Only a same-site relative path is allowed: it
 * must start with a single `/`. A backslash or ASCII control character
 * anywhere in the value is rejected because browsers normalize `\` to `/` and
 * strip tab/newline before parsing a `Location` header, which would turn
 * `/\evil.example` or `/<TAB>/evil.example` into a cross-origin URL.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
	if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
	if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
	return raw;
}
