import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { readGalleryImage } from '$lib/server/gallery';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const u = requireUser(locals);
	const tripId = Number(params.id);
	const imageId = Number(params.imageId);
	if (!Number.isSafeInteger(tripId) || tripId < 1 || !Number.isSafeInteger(imageId) || imageId < 1) {
		throw error(400, 'Invalid request');
	}
	// readGalleryImage enforces trip view access (owner or share), like trip documents.
	const { stream, record, image } = await readGalleryImage(u.id, imageId);
	if (image.ownerType !== 'trip' || image.ownerId !== tripId) throw error(404, 'Not found');

	return new Response(stream, {
		headers: {
			'Content-Type': record.contentType,
			// Gallery images are always JPEG/PNG/WebP and safe to render inline.
			'Content-Disposition': 'inline',
			'Cache-Control': 'private, no-store'
		}
	});
};
