import { error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { requireUser } from '$lib/server/auth';
import { getAttachmentWithPath } from '$lib/server/tripExpenseAttachments';
import type { RequestHandler } from './$types';

function sanitizeFilename(name: string): string {
	// Strip control chars, quotes, backslashes, and path separators to prevent
	// header injection and ensure a single basename.
	return name
		.replace(/[\x00-\x1f\x7f\\/"'\[\]{};:|<>?*]/g, '_')
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
	const attachment = getAttachmentWithPath(u.id, attachmentId);
	if (attachment.tripId !== tripId || attachment.expenseId !== expenseId) {
		throw error(404, 'Attachment not found');
	}
	const buffer = readFileSync(attachment.path);
	const safeFilename = sanitizeFilename(attachment.filename);
	return new Response(buffer, {
		headers: {
			'Content-Type': attachment.contentType,
			'Content-Disposition': `inline; filename="${safeFilename}"`,
			'Content-Length': String(buffer.length)
		}
	});
};
