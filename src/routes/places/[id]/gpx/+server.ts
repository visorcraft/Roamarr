import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { getPlaceById } from '$lib/server/places';
import { requirePositiveId } from '$lib/server/params';
import { buildContentDisposition, sanitizeDownloadFilename } from '$lib/server/httpDownload';
import {
	readAttachmentStream,
	GPX_CONTENT_TYPE
} from '$lib/server/attachments/attachmentService';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const u = requireUser(locals);
	const placeId = requirePositiveId(params.id, 400, 'Invalid place id');
	// getPlaceById scopes to the owner, so foreign places are invisible.
	const place = getPlaceById(placeId, u.id);
	if (!place || place.gpxAttachmentId == null) throw error(404, 'Not found');

	const { stream } = await readAttachmentStream(place.gpxAttachmentId);
	return new Response(stream, {
		headers: {
			'Content-Type': GPX_CONTENT_TYPE,
			// Always a download: GPX must never be rendered inline as XML/HTML.
			'Content-Disposition': buildContentDisposition(
				sanitizeDownloadFilename(place.name, { fallback: 'track', requiredExtension: '.gpx' })
			),
			'Cache-Control': 'private, no-store'
		}
	});
};
