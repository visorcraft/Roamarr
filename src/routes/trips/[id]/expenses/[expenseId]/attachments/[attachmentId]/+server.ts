import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { readAttachment } from '$lib/server/tripExpenseAttachments';
import type { RequestHandler } from './$types';

function sanitizeFilename(name: string): string {
	// Strip control chars, quotes, backslashes, and path separators to prevent
	// header injection and ensure a single basename.
	let sanitized = name
		.replace(/[\x00-\x1f\x7f\\/"'\[\]\{\};:|<>?*]/g, '_')
		.replace(/\.{2,}/g, '_')
		.trim();
	// Avoid leading dots and ensure a non-empty fallback.
	sanitized = sanitized.replace(/^[.\s]+/, '') || 'download';
	// Avoid slicing in the middle of a UTF-8 multi-byte sequence.
	const utf8 = Buffer.from(sanitized, 'utf8');
	if (utf8.length > 255) {
		let end = 255;
		while (end > 0 && (utf8[end] & 0xc0) === 0x80) end--;
		return utf8.subarray(0, end).toString('utf8');
	}
	return sanitized;
}

function contentDisposition(filename: string): string {
	// ASCII-only quoted filename for legacy clients, RFC 5987 filename* for Unicode.
	const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
	const encoded = encodeURIComponent(filename).replace(/['()]/g, escape);
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
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
			'Content-Disposition': contentDisposition(safeFilename)
		}
	});
};
