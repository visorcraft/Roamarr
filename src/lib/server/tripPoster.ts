import { error } from '@sveltejs/kit';
import { requireEditableTrip } from './ownership';
import { canView } from './sharing';
import * as tripsRepo from './repositories/tripsRepo';
import {
	createAttachment,
	readAttachmentStream,
	deleteAttachment as deleteGenericAttachment
} from './attachments/attachmentService';
import { logAudit } from './audit';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function uploadTripPoster(userId: number, tripId: number, file: File) {
	const trip = requireEditableTrip(userId, tripId);
	if (!IMAGE_TYPES.has(file.type)) throw error(400, 'Only JPEG, PNG, or WebP files are allowed');

	const attachment = await createAttachment({
		ownerId: userId,
		file,
		context: { kind: 'trip_poster', tripId }
	});

	try {
		tripsRepo.updateTrip(tripId, { posterAttachmentId: attachment.id });
	} catch (e) {
		await deleteGenericAttachment(attachment.id);
		throw e;
	}

	if (trip.posterAttachmentId && trip.posterAttachmentId !== attachment.id) {
		await deleteGenericAttachment(trip.posterAttachmentId).catch(() => {});
	}

	logAudit(userId, 'update', 'trip', tripId, {
		field: 'posterAttachmentId',
		attachmentId: attachment.id,
		filename: attachment.filename
	});

	return attachment;
}

export async function readTripPoster(userId: number, tripId: number) {
	const trip = tripsRepo.getTripById(tripId);
	if (!trip || !canView(userId, trip) || !trip.posterAttachmentId) throw error(404, 'Not found');
	const { stream, record } = await readAttachmentStream(trip.posterAttachmentId);
	if (record.context.kind !== 'trip_poster' || record.context.tripId !== tripId) throw error(404, 'Not found');
	return { stream, record };
}
