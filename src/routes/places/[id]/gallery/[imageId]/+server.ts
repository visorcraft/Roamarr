import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { readGalleryImage } from '$lib/server/gallery';
import { getPlaceById } from '$lib/server/places';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const u = requireUser(locals);
	const placeId = Number(params.id);
	const imageId = Number(params.imageId);
	if (!Number.isSafeInteger(placeId) || placeId < 1 || !Number.isSafeInteger(imageId) || imageId < 1) {
		throw error(400, 'Invalid request');
	}
	// getPlaceById scopes to the owner, so foreign places are invisible.
	if (!getPlaceById(placeId, u.id)) throw error(404, 'Not found');
	const { stream, record, image } = await readGalleryImage(u.id, imageId);
	if (image.ownerType !== 'place' || image.ownerId !== placeId) throw error(404, 'Not found');

	return new Response(stream, {
		headers: {
			'Content-Type': record.contentType,
			// Gallery images are always JPEG/PNG/WebP and safe to render inline.
			'Content-Disposition': 'inline',
			'Cache-Control': 'private, no-store'
		}
	});
};
