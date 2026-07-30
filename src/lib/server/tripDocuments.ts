import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { requireEditableTrip } from './ownership';
import { canView } from './sharing';
import { logAudit } from './audit';
import {
	createAttachment,
	readAttachmentStream,
	deleteAttachment as deleteGenericAttachment
} from './attachments/attachmentService';
import type { AttachmentRecord } from './attachments/attachmentRepo';
import * as tripsRepo from './repositories/tripsRepo';
import { getSegmentById } from './repositories/segmentsRepo';
import * as docsRepo from './repositories/tripDocumentsRepo';
import { withTripAction } from './actions';
import { positiveIdFromForm, Validator } from './validation';

export type { TripDocumentRow } from './repositories/tripDocumentsRepo';

type DocLinkContext = {
	link: docsRepo.TripDocumentLinkRow;
	tripId: number;
};

function requireDocForView(userId: number, docId: number): DocLinkContext {
	const link = docsRepo.getTripDocumentLinkById(docId);
	if (!link) throw error(404, 'Document not found');
	const trip = tripsRepo.getTripById(link.tripId);
	if (!trip || !canView(userId, trip)) throw error(404, 'Not found');
	return { link, tripId: trip.id };
}

function requireDocForEdit(userId: number, docId: number): DocLinkContext {
	const link = docsRepo.getTripDocumentLinkById(docId);
	if (!link) throw error(404, 'Document not found');
	requireEditableTrip(userId, link.tripId);
	return { link, tripId: link.tripId };
}

function assertSegmentOnTrip(tripId: number, segmentId: number | null | undefined) {
	if (segmentId == null) return null;
	const seg = getSegmentById(segmentId);
	if (!seg || seg.tripId !== tripId) throw error(400, 'Segment not found on this trip');
	return segmentId;
}

export async function addTripDocument(
	userId: number,
	tripId: number,
	input: {
		file: File;
		segmentId?: number | null;
		label?: string | null;
		notes?: string | null;
	}
): Promise<{ link: docsRepo.TripDocumentLinkRow; attachment: AttachmentRecord }> {
	requireEditableTrip(userId, tripId);
	const segmentId = assertSegmentOnTrip(tripId, input.segmentId);

	const attachment = await createAttachment({
		ownerId: userId,
		file: input.file,
		context: {
			kind: 'trip_document',
			tripId,
			segmentId: segmentId ?? null
		}
	});

	const label = input.label?.trim() || input.file.name || null;
	let link: docsRepo.TripDocumentLinkRow;
	try {
		link = docsRepo.createTripDocumentLink({
			tripId,
			segmentId,
			attachmentId: attachment.id,
			label,
			notes: input.notes
		});
	} catch (e) {
		await deleteGenericAttachment(attachment.id);
		throw e;
	}

	logAudit(userId, 'create', 'trip_document', link.id, {
		tripId,
		segmentId: segmentId ?? null,
		attachmentId: attachment.id,
		filename: input.file.name
	});

	return { link, attachment };
}

export function listTripDocuments(tripId: number) {
	return docsRepo.listDocumentsForTrip(tripId);
}

export function listSegmentDocuments(segmentId: number) {
	return docsRepo.listDocumentsForSegment(segmentId);
}

export function listDocumentsBySegment(segmentIds: number[]) {
	return docsRepo.listDocumentsForSegments(segmentIds);
}

export async function readTripDocument(
	userId: number,
	docId: number
): Promise<{
	stream: ReadableStream<Uint8Array>;
	record: AttachmentRecord;
	tripId: number;
	docId: number;
	label: string | null;
}> {
	const { link, tripId } = requireDocForView(userId, docId);
	const { stream, record } = await readAttachmentStream(link.attachmentId);
	return { stream, record, tripId, docId: link.id, label: link.label };
}

export async function deleteTripDocument(userId: number, docId: number): Promise<void> {
	const { link, tripId } = requireDocForEdit(userId, docId);
	const attachmentId = link.attachmentId;
	const attachment = await deleteGenericAttachment(attachmentId);
	docsRepo.deleteTripDocumentLink(link.id);
	logAudit(userId, 'delete', 'trip_document', docId, {
		tripId,
		segmentId: link.segmentId,
		attachmentId,
		filename: attachment.filename
	});
}

/** Collect non-empty File entries from form fields named `file` or `documents`. */
export function collectDocumentFiles(formData: FormData): File[] {
	const out: File[] = [];
	for (const key of ['file', 'documents'] as const) {
		for (const value of formData.getAll(key)) {
			if (value instanceof File && value.size > 0) out.push(value);
		}
	}
	return out;
}

export async function uploadTripDocumentAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const files = collectDocumentFiles(formData);
	if (!files.length) throw error(400, 'File is required');

	const v = new Validator();
	const label = v.optionalString(formData.get('label'), 'label', { max: 200 });
	const notes = v.optionalString(formData.get('notes'), 'notes', { max: 2000 });
	const segmentRaw = formData.get('segmentId');
	let segmentId: number | null = null;
	if (segmentRaw != null && String(segmentRaw).trim() !== '') {
		const parsed = positiveIdFromForm(segmentRaw, 'segmentId');
		if (!parsed.ok) return fail(400, { error: parsed.error });
		segmentId = parsed.value;
	}
	if (!v.ok()) return fail(400, { error: v.failMessage(), errors: v.errors });

	// First file uses optional label; additional files use their filenames.
	for (let i = 0; i < files.length; i++) {
		const file = files[i]!;
		await addTripDocument(user.id, tripId, {
			file,
			segmentId,
			label: i === 0 ? label : null,
			notes: i === 0 ? notes : null
		});
	}

	const redirectTo = String(formData.get('redirectTo') || '').trim();
	throw redirect(303, redirectTo.startsWith(`/trips/${tripId}`) ? redirectTo : `/trips/${tripId}`);
}

export async function deleteTripDocumentAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const docIdResult = positiveIdFromForm(formData.get('documentId'), 'documentId');
	if (!docIdResult.ok) return fail(400, { error: docIdResult.error });
	const link = docsRepo.getTripDocumentLinkById(docIdResult.value);
	if (!link || link.tripId !== tripId) throw error(404, 'Document not found');
	await deleteTripDocument(user.id, docIdResult.value);
	const redirectTo = String(formData.get('redirectTo') || '').trim();
	throw redirect(303, redirectTo.startsWith(`/trips/${tripId}`) ? redirectTo : `/trips/${tripId}`);
}
