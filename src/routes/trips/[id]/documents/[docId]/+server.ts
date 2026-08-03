import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { readTripDocument } from '$lib/server/tripDocuments';
import type { RequestHandler } from './$types';

function sanitizeFilename(name: string): string {
	let sanitized = name
		.replace(/[\x00-\x1f\x7f\\/"'\[\]\{\};:|<>?*]/g, '_')
		.replace(/\.{2,}/g, '_')
		.trim();
	sanitized = sanitized.replace(/^[.\s]+/, '') || 'download';
	const utf8 = Buffer.from(sanitized, 'utf8');
	if (utf8.length > 255) {
		let end = 255;
		while (end > 0 && (utf8[end]! & 0xc0) === 0x80) end--;
		return utf8.subarray(0, end).toString('utf8');
	}
	return sanitized;
}

function contentDisposition(filename: string, inline: boolean): string {
	const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
	const encoded = encodeURIComponent(filename).replace(/['()]/g, escape);
	return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Only images and PDFs may open inline; everything else (e.g. GPX) is a download. */
function canServeInline(contentType: string): boolean {
	return contentType === 'application/pdf' || contentType.startsWith('image/');
}

export const GET: RequestHandler = async ({ locals, params }) => {
	const u = requireUser(locals);
	const tripId = Number(params.id);
	const docId = Number(params.docId);
	if (!Number.isFinite(tripId) || !Number.isFinite(docId)) {
		throw error(400, 'Invalid request');
	}
	const { stream, record, tripId: actualTripId, label } = await readTripDocument(u.id, docId);
	if (actualTripId !== tripId) throw error(404, 'Document not found');

	const displayName = label?.trim() || record.filename;
	const safeFilename = sanitizeFilename(displayName);
	return new Response(stream, {
		headers: {
			'Content-Type': record.contentType,
			'Content-Disposition': contentDisposition(safeFilename, canServeInline(record.contentType)),
			'Cache-Control': 'private, no-store'
		}
	});
};
