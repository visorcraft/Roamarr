import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { readAttachment } from '$lib/server/tripExpenseAttachments';
import type { RequestHandler } from './$types';

function sanitizeFilename(name: string): string {
	// Strip control chars, quotes, backslashes, and path separators to prevent
	// header injection and ensure a single basename.
	return name
		.replace(/[\x00-\x1f\x7f\\/"'\[\]\{\};:|<>?*]/g, '_')
		.replace(/\.{2,}/g, '_')
		.slice(0, 255);
}

export const GET: RequestHandler = async ({ locals, params }) => {
	const u = requireUser(locals);
	const tripId = Number(params.id);
	const expenseId = Number(params.expenseId);
	const attachmentId = Number(params.attachmentId);
	if (!Number.isFinite(tripId) || !Number.isFinite(expenseId) || !Number.isFinite(attachmentId)) {
		throw error(400, 'Invalid request');
	}
	const { stream, record, tripId: actualTripId, expenseId: actualExpenseId } = await readAttachment(
		u.id,
		attachmentId
	);
	if (actualTripId !== tripId || actualExpenseId !== expenseId) {
		throw error(404, 'Attachment not found');
	}
	const safeFilename = sanitizeFilename(record.filename);
	return new Response(stream, {
		headers: {
			'Content-Type': record.contentType,
			'Content-Disposition': `attachment; filename="${safeFilename}"`
		}
	});
};
