import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { eq, and, inList } from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import { galleryImages } from '$lib/server/db/mongrelSchema';
import type { GalleryOwnerType } from '$lib/server/db/mongrelSchema';
import { requireEditableTrip, requireViewableTrip } from './ownership';
import { getPlaceById, setPlaceImageAttachment } from './places';
import {
	createAttachment,
	deleteAttachment,
	readAttachmentStream
} from './attachments/attachmentService';
import { getAttachmentById } from './attachments/attachmentRepo';
import { withTripAction } from './actions';
import { logAudit } from './audit';
import { publishTripChanged } from './eventBus';
import { positiveIdFromForm, Validator } from './validation';
import type { Row, Insert } from '@visorcraft/mongreldb-kit';

/** Live-sync: only trip-owned galleries feed the trip-page invalidation stream. */
function publishGalleryChanged(ownerType: GalleryOwnerType, ownerId: number) {
	if (ownerType === 'trip') publishTripChanged(ownerId);
}

/** Galleries hold images only, even though the attachment store also allows PDF/GPX. */
export const GALLERY_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_GALLERY_IMAGES = 50;
export const MAX_CAPTION_LENGTH = 200;

export interface GalleryImage {
	id: number;
	ownerType: GalleryOwnerType;
	ownerId: number;
	attachmentId: number;
	caption: string | null;
	sortOrder: number;
	createdAt: string;
	filename: string;
	contentType: string;
	sizeBytes: number;
}

function toGalleryImage(row: Row<typeof galleryImages>): GalleryImage {
	const attachment = getAttachmentById(Number(row.attachment_id));
	return {
		id: Number(row.id),
		ownerType: row.owner_type as GalleryOwnerType,
		ownerId: Number(row.owner_id),
		attachmentId: Number(row.attachment_id),
		caption: row.caption ?? null,
		sortOrder: Number(row.sort_order),
		createdAt: row.created_at,
		filename: attachment?.filename ?? 'image',
		contentType: attachment?.contentType ?? 'image/jpeg',
		sizeBytes: attachment?.sizeBytes ?? 0
	};
}

function sortImages(images: GalleryImage[]): GalleryImage[] {
	return images.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

/** Unauthenticated listing, like listTripDocuments: callers enforce access. */
export function listGalleryImages(ownerType: GalleryOwnerType, ownerId: number): GalleryImage[] {
	const rows = kit
		.selectFrom(galleryImages)
		.where(and(eq(galleryImages.owner_type, ownerType), eq(galleryImages.owner_id, BigInt(ownerId))))
		.executeSync();
	return sortImages(rows.map(toGalleryImage));
}

/** Batch listing for index pages (e.g. the Places page). Callers enforce access. */
export function listGalleriesForOwners(
	ownerType: GalleryOwnerType,
	ownerIds: number[]
): Map<number, GalleryImage[]> {
	const result = new Map<number, GalleryImage[]>();
	if (ownerIds.length === 0) return result;
	const rows = kit
		.selectFrom(galleryImages)
		.where(
			and(
				eq(galleryImages.owner_type, ownerType),
				inList(galleryImages.owner_id, ownerIds.map((id) => BigInt(id)))
			)
		)
		.executeSync();
	for (const row of rows) {
		const image = toGalleryImage(row);
		const list = result.get(image.ownerId) ?? [];
		list.push(image);
		result.set(image.ownerId, list);
	}
	for (const list of result.values()) sortImages(list);
	return result;
}

function getGalleryImageRow(imageId: number): Row<typeof galleryImages> | null {
	return (
		kit.selectFrom(galleryImages).where(eq(galleryImages.id, BigInt(imageId))).executeSync()[0] ??
		null
	);
}

/** Single image lookup without authorization; callers enforce access. */
export function getGalleryImage(imageId: number): GalleryImage | null {
	const row = getGalleryImageRow(imageId);
	return row ? toGalleryImage(row) : null;
}

function requireGalleryRead(userId: number, ownerType: GalleryOwnerType, ownerId: number): void {
	if (ownerType === 'place') {
		// Places have no sharing: only the owner can read a place gallery.
		if (!getPlaceById(ownerId, userId)) throw error(404, 'Not found');
		return;
	}
	requireViewableTrip(userId, ownerId);
}

function requireGalleryWrite(userId: number, ownerType: GalleryOwnerType, ownerId: number): void {
	if (ownerType === 'place') {
		if (!getPlaceById(ownerId, userId)) throw error(404, 'Not found');
		return;
	}
	requireEditableTrip(userId, ownerId);
}

/** Authorized read: place owner, or anyone who can view the trip. */
export function listGallery(
	userId: number,
	ownerType: GalleryOwnerType,
	ownerId: number
): GalleryImage[] {
	requireGalleryRead(userId, ownerType, ownerId);
	return listGalleryImages(ownerType, ownerId);
}

/** Authorized image download (mirrors readTripDocument): returns the decrypted stream. */
export async function readGalleryImage(userId: number, imageId: number) {
	const row = getGalleryImageRow(imageId);
	if (!row) throw error(404, 'Not found');
	requireGalleryRead(userId, row.owner_type as GalleryOwnerType, Number(row.owner_id));
	const { stream, record } = await readAttachmentStream(Number(row.attachment_id));
	return { stream, record, image: toGalleryImage(row) };
}

function nextSortOrder(ownerType: GalleryOwnerType, ownerId: number): number {
	const existing = listGalleryImages(ownerType, ownerId);
	return existing.length === 0 ? 0 : existing[existing.length - 1]!.sortOrder + 1;
}

/** Batch upload. Images only (JPEG/PNG/WebP); PDF/GPX are rejected here. */
export async function addGalleryImages(
	userId: number,
	ownerType: GalleryOwnerType,
	ownerId: number,
	files: File[]
): Promise<GalleryImage[]> {
	requireGalleryWrite(userId, ownerType, ownerId);
	if (files.length === 0) throw error(400, 'At least one image file is required');
	const current = listGalleryImages(ownerType, ownerId);
	if (current.length + files.length > MAX_GALLERY_IMAGES) {
		throw error(400, `A gallery can hold at most ${MAX_GALLERY_IMAGES} images`);
	}
	for (const file of files) {
		if (!GALLERY_IMAGE_TYPES.includes(file.type as (typeof GALLERY_IMAGE_TYPES)[number])) {
			throw error(400, 'Only JPEG, PNG, or WebP images are allowed in galleries');
		}
	}

	let sortOrder = nextSortOrder(ownerType, ownerId);
	const added: GalleryImage[] = [];
	for (const file of files) {
		const attachment = await createAttachment({
			ownerId: userId,
			file,
			context: { kind: 'gallery_image', ownerType, ownerId }
		});
		try {
			const row = kit
				.insertInto(galleryImages)
				.values({
					owner_type: ownerType,
					owner_id: BigInt(ownerId),
					attachment_id: BigInt(attachment.id),
					sort_order: BigInt(sortOrder)
				} as Insert<typeof galleryImages>)
				.executeSync();
			added.push(toGalleryImage(row));
			sortOrder += 1;
		} catch (e) {
			await deleteAttachment(attachment.id);
			throw e;
		}
	}

	// A place's cover is its first gallery image; only set when not already set.
	if (ownerType === 'place' && added.length > 0) {
		const place = getPlaceById(ownerId, userId);
		if (place && place.imageAttachmentId == null) {
			setPlaceImageAttachment(ownerId, userId, added[0]!.attachmentId);
		}
	}

	for (const image of added) {
		logAudit(userId, 'gallery_image_add', 'gallery_image', image.id, {
			ownerType,
			ownerId,
			tripId: ownerType === 'trip' ? ownerId : undefined,
			attachmentId: image.attachmentId,
			filename: image.filename
		});
	}
	publishGalleryChanged(ownerType, ownerId);
	return added;
}

/** Remove one image and delete the underlying attachment (ciphertext included). */
export async function removeGalleryImage(userId: number, imageId: number): Promise<void> {
	const row = getGalleryImageRow(imageId);
	if (!row) throw error(404, 'Not found');
	const ownerType = row.owner_type as GalleryOwnerType;
	const ownerId = Number(row.owner_id);
	requireGalleryWrite(userId, ownerType, ownerId);
	const attachmentId = Number(row.attachment_id);

	kit.deleteFrom(galleryImages).where(eq(galleryImages.id, BigInt(imageId))).executeSync();
	await deleteAttachment(attachmentId);

	// Keep the place cover pointing at a real image (next in order), or clear it.
	if (ownerType === 'place') {
		const place = getPlaceById(ownerId, userId);
		if (place && place.imageAttachmentId === attachmentId) {
			const remaining = listGalleryImages(ownerType, ownerId);
			setPlaceImageAttachment(ownerId, userId, remaining[0]?.attachmentId ?? null);
		}
	}

	logAudit(userId, 'gallery_image_remove', 'gallery_image', imageId, {
		ownerType,
		ownerId,
		tripId: ownerType === 'trip' ? ownerId : undefined,
		attachmentId
	});
	publishGalleryChanged(ownerType, ownerId);
}

/** Replace the ordering. imageIds must be exactly the current set, once each. */
export function reorderGallery(
	userId: number,
	ownerType: GalleryOwnerType,
	ownerId: number,
	imageIds: number[]
): GalleryImage[] {
	requireGalleryWrite(userId, ownerType, ownerId);
	const current = listGalleryImages(ownerType, ownerId);
	const currentIds = new Set(current.map((i) => i.id));
	if (
		imageIds.length !== current.length ||
		new Set(imageIds).size !== imageIds.length ||
		!imageIds.every((id) => currentIds.has(id))
	) {
		throw error(400, 'Order must list every gallery image exactly once');
	}
	imageIds.forEach((id, index) => {
		kit.updateTable(galleryImages)
			.set({ sort_order: BigInt(index) })
			.where(eq(galleryImages.id, BigInt(id)))
			.executeSync();
	});
	logAudit(userId, 'gallery_image_reorder', 'gallery_image', 0, {
		ownerType,
		ownerId,
		tripId: ownerType === 'trip' ? ownerId : undefined
	});
	publishGalleryChanged(ownerType, ownerId);
	return listGalleryImages(ownerType, ownerId);
}

/** Move one image one step earlier/later; used by the web move buttons. */
export function moveGalleryImage(
	userId: number,
	imageId: number,
	direction: 'earlier' | 'later'
): GalleryImage[] {
	const row = getGalleryImageRow(imageId);
	if (!row) throw error(404, 'Not found');
	const ownerType = row.owner_type as GalleryOwnerType;
	const ownerId = Number(row.owner_id);
	const current = listGalleryImages(ownerType, ownerId);
	const index = current.findIndex((i) => i.id === imageId);
	const target = direction === 'earlier' ? index - 1 : index + 1;
	if (index === -1 || target < 0 || target >= current.length) return current;
	const ids = current.map((i) => i.id);
	[ids[index], ids[target]] = [ids[target]!, ids[index]!];
	return reorderGallery(userId, ownerType, ownerId, ids);
}

export function setGalleryCaption(
	userId: number,
	imageId: number,
	caption: string | null
): GalleryImage {
	const row = getGalleryImageRow(imageId);
	if (!row) throw error(404, 'Not found');
	const ownerType = row.owner_type as GalleryOwnerType;
	const ownerId = Number(row.owner_id);
	requireGalleryWrite(userId, ownerType, ownerId);
	const trimmed = caption?.trim() || null;
	if (trimmed && trimmed.length > MAX_CAPTION_LENGTH) {
		throw error(400, `Caption must be ${MAX_CAPTION_LENGTH} characters or less`);
	}
	const rows = kit
		.updateTable(galleryImages)
		.set({ caption: trimmed })
		.where(eq(galleryImages.id, BigInt(imageId)))
		.executeSync();
	logAudit(userId, 'gallery_image_caption', 'gallery_image', imageId, {
		ownerType,
		ownerId,
		tripId: ownerType === 'trip' ? ownerId : undefined
	});
	publishGalleryChanged(ownerType, ownerId);
	return toGalleryImage(rows[0]!);
}

/**
 * Delete every gallery row and attachment for an owner. No authorization here;
 * callers (deletePlace, _deleteTrip) authorize the owner deletion itself.
 * Returns the deleted attachment ids so callers can skip double-deletes.
 */
export async function deleteGalleryForOwner(
	ownerType: GalleryOwnerType,
	ownerId: number
): Promise<number[]> {
	const images = listGalleryImages(ownerType, ownerId);
	const attachmentIds: number[] = [];
	for (const image of images) {
		kit.deleteFrom(galleryImages).where(eq(galleryImages.id, BigInt(image.id))).executeSync();
		try {
			await deleteAttachment(image.attachmentId);
		} catch (e) {
			console.warn('Failed to delete gallery attachment', {
				ownerType,
				ownerId,
				attachmentId: image.attachmentId,
				error: e
			});
		}
		attachmentIds.push(image.attachmentId);
	}
	return attachmentIds;
}

/** Deliberate MCP projection: no storage keys, no internal attachment rows. */
export function projectGalleryImage(image: GalleryImage) {
	return {
		id: image.id,
		ownerType: image.ownerType,
		ownerId: image.ownerId,
		caption: image.caption,
		sortOrder: image.sortOrder,
		filename: image.filename,
		contentType: image.contentType,
		sizeBytes: image.sizeBytes,
		createdAt: image.createdAt
	};
}

// ============================================================================
// Trip page form actions
// ============================================================================

/** Collect non-empty File entries from form fields named `images` or `file`. */
export function collectGalleryFiles(formData: FormData): File[] {
	const out: File[] = [];
	for (const key of ['images', 'file'] as const) {
		for (const value of formData.getAll(key)) {
			if (value instanceof File && value.size > 0) out.push(value);
		}
	}
	return out;
}

function galleryRedirect(tripId: number, formData: FormData): never {
	const redirectTo = String(formData.get('redirectTo') || '').trim();
	throw redirect(303, redirectTo.startsWith(`/trips/${tripId}`) ? redirectTo : `/trips/${tripId}`);
}

function requireTripGalleryImage(imageId: number, tripId: number): void {
	const row = getGalleryImageRow(imageId);
	if (!row || row.owner_type !== 'trip' || Number(row.owner_id) !== tripId) {
		throw error(404, 'Not found');
	}
}

export async function uploadGalleryImagesAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const files = collectGalleryFiles(formData);
	if (!files.length) throw error(400, 'At least one image file is required');
	await addGalleryImages(user.id, 'trip', tripId, files);
	galleryRedirect(tripId, formData);
}

export async function removeGalleryImageAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const parsed = positiveIdFromForm(formData.get('imageId'), 'imageId');
	if (!parsed.ok) return fail(400, { error: parsed.error });
	requireTripGalleryImage(parsed.value, tripId);
	await removeGalleryImage(user.id, parsed.value);
	galleryRedirect(tripId, formData);
}

export async function moveGalleryImageAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const parsed = positiveIdFromForm(formData.get('imageId'), 'imageId');
	if (!parsed.ok) return fail(400, { error: parsed.error });
	requireTripGalleryImage(parsed.value, tripId);
	const direction = String(formData.get('direction') || '');
	if (direction !== 'earlier' && direction !== 'later') {
		return fail(400, { error: 'direction must be earlier or later' });
	}
	moveGalleryImage(user.id, parsed.value, direction);
	galleryRedirect(tripId, formData);
}

export async function setGalleryCaptionAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const parsed = positiveIdFromForm(formData.get('imageId'), 'imageId');
	if (!parsed.ok) return fail(400, { error: parsed.error });
	requireTripGalleryImage(parsed.value, tripId);
	const v = new Validator();
	const caption = v.optionalString(formData.get('caption'), 'caption', { max: MAX_CAPTION_LENGTH });
	if (!v.ok()) return fail(400, { error: v.failMessage(), errors: v.errors });
	setGalleryCaption(user.id, parsed.value, caption ?? null);
	galleryRedirect(tripId, formData);
}
