import { error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { requireUser } from '$lib/server/auth';
import { getAttachmentWithPath } from '$lib/server/tripExpenseAttachments';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const u = requireUser(locals);
	const tripId = Number(params.id);
	const expenseId = Number(params.expenseId);
	const attachmentId = Number(params.attachmentId);
	if (!Number.isFinite(tripId) || !Number.isFinite(expenseId) || !Number.isFinite(attachmentId)) {
		throw error(400, 'Invalid request');
	}
	const attachment = getAttachmentWithPath(u.id, attachmentId);
	if (attachment.tripId !== tripId || attachment.expenseId !== expenseId) {
		throw error(404, 'Attachment not found');
	}
	const buffer = readFileSync(attachment.path);
	return new Response(buffer, {
		headers: {
			'Content-Type': attachment.contentType,
			'Content-Disposition': `inline; filename="${attachment.filename}"`,
			'Content-Length': String(buffer.length)
		}
	});
};
