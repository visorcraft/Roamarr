import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { requireViewableTrip } from '$lib/server/ownership';
import {
	addTripDocument,
	listTripDocuments
} from '$lib/server/tripDocuments';

const tripIdParam = (value: string | undefined) => {
	const id = Number(value);
	if (!Number.isSafeInteger(id) || id < 1) throw error(400, 'Invalid trip id');
	return id;
};

export const GET: RequestHandler = ({ params, locals, url }) => {
	const user = requireUser(locals);
	const tripId = tripIdParam(params.id);
	requireViewableTrip(user.id, tripId);

	const segmentRaw = url.searchParams.get('segmentId');
	let rows = listTripDocuments(tripId);
	if (segmentRaw != null && segmentRaw.trim() !== '') {
		const segmentId = Number(segmentRaw);
		if (!Number.isSafeInteger(segmentId) || segmentId < 1) throw error(400, 'Invalid segment id');
		rows = rows.filter((row) => row.segmentId === segmentId);
	}

	return json({
		rows: rows.map((row) => ({
			id: row.id,
			tripId: row.tripId,
			segmentId: row.segmentId,
			label: row.label,
			notes: row.notes,
			filename: row.filename,
			contentType: row.contentType,
			sizeBytes: row.sizeBytes,
			createdAt: row.createdAt
		}))
	});
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = requireUser(locals);
	const tripId = tripIdParam(params.id);
	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File) || file.size === 0) throw error(400, 'File required');

	const labelRaw = form.get('label');
	const notesRaw = form.get('notes');
	const segmentRaw = form.get('segmentId');
	let segmentId: number | null = null;
	if (segmentRaw != null && String(segmentRaw).trim() !== '') {
		const parsed = Number(segmentRaw);
		if (!Number.isSafeInteger(parsed) || parsed < 1) throw error(400, 'Invalid segment id');
		segmentId = parsed;
	}

	const result = await addTripDocument(user.id, tripId, {
		file,
		segmentId,
		label: typeof labelRaw === 'string' ? labelRaw : null,
		notes: typeof notesRaw === 'string' ? notesRaw : null
	});

	return json(
		{
			id: result.link.id,
			filename: result.attachment.filename,
			label: result.link.label,
			segmentId: result.link.segmentId
		},
		{ status: 201 }
	);
};
