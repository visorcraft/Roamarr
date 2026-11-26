import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePositiveId } from '$lib/server/params';
import { requireUser } from '$lib/server/auth';
import { requireViewableTrip } from '$lib/server/ownership';
import { canViewDetails } from '$lib/server/sharing';
import {
	addTripDocument,
	listTripDocuments
} from '$lib/server/tripDocuments';

export const GET: RequestHandler = ({ params, locals, url }) => {
	const user = requireUser(locals);
	const tripId = requirePositiveId(params.id, 400, 'Invalid trip id');
	const trip = requireViewableTrip(user.id, tripId);
	const showNotes = canViewDetails(user.id, trip);

	const segmentRaw = url.searchParams.get('segmentId');
	let rows = listTripDocuments(tripId);
	if (segmentRaw != null && segmentRaw.trim() !== '') {
		const segmentId = requirePositiveId(segmentRaw.trim(), 400, 'Invalid segment id');
		rows = rows.filter((row) => row.segmentId === segmentId);
	}

	return json({
		rows: rows.map((row) => ({
			id: row.id,
			tripId: row.tripId,
			segmentId: row.segmentId,
			label: row.label,
			notes: showNotes ? row.notes : null,
			filename: row.filename,
			contentType: row.contentType,
			sizeBytes: row.sizeBytes,
			createdAt: row.createdAt
		}))
	});
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = requireUser(locals);
	const tripId = requirePositiveId(params.id, 400, 'Invalid trip id');
	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File) || file.size === 0) throw error(400, 'File required');

	const labelRaw = form.get('label');
	const notesRaw = form.get('notes');
	const segmentRaw = form.get('segmentId');
	let segmentId: number | null = null;
	if (segmentRaw != null && String(segmentRaw).trim() !== '') {
		segmentId = requirePositiveId(String(segmentRaw).trim(), 400, 'Invalid segment id');
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
