import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { deleteTripDocument, readTripDocument } from '$lib/server/tripDocuments';

const positiveId = (value: string | undefined, label: string) => {
	const id = Number(value);
	if (!Number.isSafeInteger(id) || id < 1) throw error(400, `Invalid ${label}`);
	return id;
};

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
	const kind = inline ? 'inline' : 'attachment';
	return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export const GET: RequestHandler = async ({ params, locals, url }) => {
	const user = requireUser(locals);
	const tripId = positiveId(params.id, 'trip id');
	const docId = positiveId(params.docId, 'document id');
	const { stream, record, tripId: actualTripId, label } = await readTripDocument(user.id, docId);
	if (actualTripId !== tripId) throw error(404, 'Document not found');

	const displayName = label?.trim() || record.filename;
	const safeFilename = sanitizeFilename(displayName);
	const inline = url.searchParams.get('inline') === '1';
	return new Response(stream, {
		headers: {
			'Content-Type': record.contentType,
			'Content-Length': String(record.sizeBytes),
			'Content-Disposition': contentDisposition(safeFilename, inline),
			'Cache-Control': 'private, no-store'
		}
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const user = requireUser(locals);
	const tripId = positiveId(params.id, 'trip id');
	const docId = positiveId(params.docId, 'document id');
	const { tripId: actualTripId } = await readTripDocument(user.id, docId);
	if (actualTripId !== tripId) throw error(404, 'Document not found');
	await deleteTripDocument(user.id, docId);
	return new Response(null, { status: 204 });
};
