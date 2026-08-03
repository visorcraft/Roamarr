import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { getPlaceById } from '$lib/server/places';
import {
	readAttachmentStream,
	GPX_CONTENT_TYPE
} from '$lib/server/attachments/attachmentService';
import type { RequestHandler } from './$types';

function sanitizeFilename(name: string): string {
	let sanitized = name
		.replace(/[\x00-\x1f\x7f\\/"'\[\]\{\};:|<>?*]/g, '_')
		.replace(/\.{2,}/g, '_')
		.trim();
	sanitized = sanitized.replace(/^[.\s]+/, '') || 'track';
	if (!sanitized.toLowerCase().endsWith('.gpx')) sanitized += '.gpx';
	const utf8 = Buffer.from(sanitized, 'utf8');
	if (utf8.length > 255) {
		let end = 255;
		while (end > 0 && (utf8[end]! & 0xc0) === 0x80) end--;
		return utf8.subarray(0, end).toString('utf8');
	}
	return sanitized;
}

function contentDisposition(filename: string): string {
	const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
	const encoded = encodeURIComponent(filename).replace(/['()]/g, escape);
	// Always a download: GPX must never be rendered inline as XML/HTML.
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export const GET: RequestHandler = async ({ locals, params }) => {
	const u = requireUser(locals);
	const placeId = Number(params.id);
	if (!Number.isSafeInteger(placeId) || placeId < 1) throw error(400, 'Invalid place id');
	// getPlaceById scopes to the owner, so foreign places are invisible.
	const place = getPlaceById(placeId, u.id);
	if (!place || place.gpxAttachmentId == null) throw error(404, 'Not found');

	const { stream } = await readAttachmentStream(place.gpxAttachmentId);
	return new Response(stream, {
		headers: {
			'Content-Type': GPX_CONTENT_TYPE,
			'Content-Disposition': contentDisposition(sanitizeFilename(place.name)),
			'Cache-Control': 'private, no-store'
		}
	});
};
