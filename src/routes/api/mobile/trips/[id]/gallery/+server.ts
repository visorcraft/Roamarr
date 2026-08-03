import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { addGalleryImagesFromForm, projectGalleryImage } from '$lib/server/gallery';

const tripIdParam = (value: string | undefined) => {
	const id = Number(value);
	if (!Number.isSafeInteger(id) || id < 1) throw error(400, 'Invalid trip id');
	return id;
};

// Mobile gallery upload, mirroring /api/mobile/trips/[id]/documents: multipart
// body, bearer/API-key auth, scope enforced by hooks (POST → trips:write).
// addGalleryImagesFromForm enforces editable-trip access, image types, and the
// per-gallery cap; auditing happens inside the gallery module.
export const POST: RequestHandler = async ({ params, request, locals, getClientAddress }) => {
	const user = requireUser(locals);
	const limit = checkRateLimit(getClientAddress(), 'mobile:gallery:upload');
	if (!limit.allowed) throw error(429, 'Too many attempts. Try again later.');
	const images = await addGalleryImagesFromForm(
		user.id,
		'trip',
		tripIdParam(params.id),
		await request.formData()
	);
	return json({ images: images.map(projectGalleryImage) }, { status: 201 });
};
