import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { readTripDocument } from '$lib/server/tripDocuments';
import { requirePositiveId } from '$lib/server/params';
import { buildContentDisposition, canServeInline, sanitizeDownloadFilename } from '$lib/server/httpDownload';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const u = requireUser(locals);
	const tripId = requirePositiveId(params.id, 400, 'Invalid request');
	const docId = requirePositiveId(params.docId, 400, 'Invalid request');
	const { stream, record, tripId: actualTripId, label } = await readTripDocument(u.id, docId);
	if (actualTripId !== tripId) throw error(404, 'Document not found');

	const displayName = label?.trim() || record.filename;
	const safeFilename = sanitizeDownloadFilename(displayName);
	return new Response(stream, {
		headers: {
			'Content-Type': record.contentType,
			'Content-Disposition': buildContentDisposition(safeFilename, canServeInline(record.contentType)),
			'Cache-Control': 'private, no-store'
		}
	});
};
