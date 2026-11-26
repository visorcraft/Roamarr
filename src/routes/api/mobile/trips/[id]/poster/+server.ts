import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePositiveId } from '$lib/server/params';
import { requireUser } from '$lib/server/auth';
import { readTripPoster, uploadTripPoster } from '$lib/server/tripPoster';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = requireUser(locals);
	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) throw error(400, 'File required');
	const attachment = await uploadTripPoster(user.id, requirePositiveId(params.id, 400, 'Invalid trip id'), file);
	return json({ id: attachment.id, filename: attachment.filename }, { status: 201 });
};

export const GET: RequestHandler = async ({ params, locals }) => {
	const user = requireUser(locals);
	const { stream, record } = await readTripPoster(user.id, requirePositiveId(params.id, 400, 'Invalid trip id'));
	return new Response(stream, { headers: { 'content-type': record.contentType, 'content-length': String(record.sizeBytes) } });
};
