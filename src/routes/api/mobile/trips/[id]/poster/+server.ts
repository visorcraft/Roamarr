import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { readTripPoster, uploadTripPoster } from '$lib/server/tripPoster';

const tripId = (value: string) => { const id = Number(value); if (!Number.isSafeInteger(id) || id < 1) throw error(400, 'Invalid trip id'); return id; };

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = requireUser(locals);
	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) throw error(400, 'File required');
	const attachment = await uploadTripPoster(user.id, tripId(params.id), file);
	return json({ id: attachment.id, filename: attachment.filename }, { status: 201 });
};

export const GET: RequestHandler = async ({ params, locals }) => {
	const user = requireUser(locals);
	const { stream, record } = await readTripPoster(user.id, tripId(params.id));
	return new Response(stream, { headers: { 'content-type': record.contentType, 'content-length': String(record.sizeBytes) } });
};
