import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePositiveId } from '$lib/server/params';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { addGalleryImagesFromForm, projectGalleryImage } from '$lib/server/gallery';

// Mobile place-gallery upload. Places have no sharing, so only the owner can
// upload (enforced inside addGalleryImagesFromForm); scope is enforced by
// hooks (POST → saved-places:write).
export const POST: RequestHandler = async ({ params, request, locals, getClientAddress }) => {
	const user = requireUser(locals);
	const limit = checkRateLimit(getClientAddress(), 'mobile:gallery:upload');
	if (!limit.allowed) throw error(429, 'Too many attempts. Try again later.');
	const images = await addGalleryImagesFromForm(
		user.id,
		'place',
		requirePositiveId(params.id, 400, 'Invalid place id'),
		await request.formData()
	);
	return json({ images: images.map(projectGalleryImage) }, { status: 201 });
};
