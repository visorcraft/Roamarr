import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { readAttachment } from '$lib/server/tripExpenseAttachments';
import { requirePositiveId } from '$lib/server/params';
import { buildContentDisposition, sanitizeDownloadFilename } from '$lib/server/httpDownload';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const u = requireUser(locals);
	const tripId = requirePositiveId(params.id, 400, 'Invalid request');
	const expenseId = requirePositiveId(params.expenseId, 400, 'Invalid request');
	const attachmentId = requirePositiveId(params.attachmentId, 400, 'Invalid request');
	const { stream, record, tripId: actualTripId, expenseId: actualExpenseId } = await readAttachment(
		u.id,
		attachmentId
	);
	if (actualTripId !== tripId || actualExpenseId !== expenseId) {
		throw error(404, 'Attachment not found');
	}
	const safeFilename = sanitizeDownloadFilename(record.filename);
	return new Response(stream, {
		headers: {
			'Content-Type': record.contentType,
			'Content-Disposition': buildContentDisposition(safeFilename)
		}
	});
};
