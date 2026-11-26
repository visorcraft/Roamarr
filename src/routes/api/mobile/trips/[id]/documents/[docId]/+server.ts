import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePositiveId } from '$lib/server/params';
import { requireUser } from '$lib/server/auth';
import { deleteTripDocument, readTripDocument } from '$lib/server/tripDocuments';
import { buildContentDisposition, canServeInline, sanitizeDownloadFilename } from '$lib/server/httpDownload';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	const user = requireUser(locals);
	const tripId = requirePositiveId(params.id, 400, 'Invalid trip id');
	const docId = requirePositiveId(params.docId, 400, 'Invalid document id');
	const { stream, record, tripId: actualTripId, label } = await readTripDocument(user.id, docId);
	if (actualTripId !== tripId) throw error(404, 'Document not found');

	const displayName = label?.trim() || record.filename;
	const safeFilename = sanitizeDownloadFilename(displayName);
	// Only images and PDFs may open inline; GPX and anything else downloads.
	const inline = canServeInline(record.contentType) && url.searchParams.get('inline') === '1';
	return new Response(stream, {
		headers: {
			'Content-Type': record.contentType,
			'Content-Length': String(record.sizeBytes),
			'Content-Disposition': buildContentDisposition(safeFilename, inline),
			'Cache-Control': 'private, no-store'
		}
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const user = requireUser(locals);
	const tripId = requirePositiveId(params.id, 400, 'Invalid trip id');
	const docId = requirePositiveId(params.docId, 400, 'Invalid document id');
	const { tripId: actualTripId } = await readTripDocument(user.id, docId);
	if (actualTripId !== tripId) throw error(404, 'Document not found');
	await deleteTripDocument(user.id, docId);
	return new Response(null, { status: 204 });
};
