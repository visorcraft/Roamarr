import { test, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

let baseDir: string;
let originalAttachmentsPath: string | undefined;

beforeEach(() => {
	originalAttachmentsPath = process.env.ATTACHMENTS_PATH;
	baseDir = mkdtempSync(path.join(tmpdir(), 'roamarr-gallery-'));
	process.env.ATTACHMENTS_PATH = baseDir;
	ctx.kit.deleteFrom(galleryImages).executeSync();
	ctx.kit.deleteFrom(attachments).executeSync();
	ctx.kit.deleteFrom(tripShares).executeSync();
	ctx.kit.deleteFrom(trips).executeSync();
	ctx.kit.deleteFrom(places).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
});

afterEach(() => {
	if (existsSync(baseDir)) rmSync(baseDir, { recursive: true, force: true });
	if (originalAttachmentsPath === undefined) {
		delete process.env.ATTACHMENTS_PATH;
	} else {
		process.env.ATTACHMENTS_PATH = originalAttachmentsPath;
	}
});

afterAll(() => {
	ctx.close();
});

import {
	listGallery,
	listGalleryImages,
	addGalleryImages,
	removeGalleryImage,
	reorderGallery,
	moveGalleryImage,
	setGalleryCaption,
	deleteGalleryForOwner,
	projectGalleryImage,
	MAX_GALLERY_IMAGES
} from './gallery';
import { getPlaceById, createPlace, deletePlace } from './places';
import { viewerProjection } from './sharing';
import {
	galleryImages,
	attachments,
	places,
	trips,
	tripShares,
	auditLogs,
	users
} from './db/mongrelSchema';
import { makeUser, makeTrip, makeShare } from '../../../tests/helpers';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';

// Real PNG magic bytes so the attachment store's sniffing accepts the file.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function pngFile(name = 'photo.png') {
	return new File([PNG_BYTES], name, { type: 'image/png' });
}

function makePlace(userId: number, name = 'Overlook') {
	return createPlace(userId, { name });
}

test('batch add stores images in upload order and lists them sorted', async () => {
	const user = makeUser(ctx.kit);
	const place = makePlace(user.id);

	const added = await addGalleryImages(user.id, 'place', place.id, [
		pngFile('a.png'),
		pngFile('b.png'),
		pngFile('c.png')
	]);
	expect(added).toHaveLength(3);
	expect(added.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
	expect(added[0].filename).toBe('a.png');
	expect(added[0].contentType).toBe('image/png');

	const listed = listGallery(user.id, 'place', place.id);
	expect(listed.map((i) => i.filename)).toEqual(['a.png', 'b.png', 'c.png']);
	// Second batch continues the sort order.
	const more = await addGalleryImages(user.id, 'place', place.id, [pngFile('d.png')]);
	expect(more[0].sortOrder).toBe(3);
});

test('add rejects PDF and GPX even though the attachment store allows them', async () => {
	const user = makeUser(ctx.kit);
	const place = makePlace(user.id);
	const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'doc.pdf', {
		type: 'application/pdf'
	});
	await expect(addGalleryImages(user.id, 'place', place.id, [pdf])).rejects.toEqual(
		expect.objectContaining({ status: 400 })
	);
	expect(listGalleryImages('place', place.id)).toHaveLength(0);
	expect(ctx.kit.selectFrom(attachments).executeSync()).toHaveLength(0);
});

test('add enforces the per-owner image cap', async () => {
	const user = makeUser(ctx.kit);
	const place = makePlace(user.id);
	// Seed the gallery to the cap with direct rows (real uploads would be slow).
	for (let i = 0; i < MAX_GALLERY_IMAGES; i++) {
		const att = ctx.kit
			.insertInto(attachments)
			.values({
				owner_id: BigInt(user.id),
				storage_key: `seed-${i}`,
				filename: `seed-${i}.png`,
				content_type: 'image/png',
				size_bytes: 1n,
				context: '{}'
			} as never)
			.executeSync();
		ctx.kit
			.insertInto(galleryImages)
			.values({
				owner_type: 'place',
				owner_id: BigInt(place.id),
				attachment_id: att.id,
				sort_order: BigInt(i)
			} as never)
			.executeSync();
	}
	await expect(addGalleryImages(user.id, 'place', place.id, [pngFile()])).rejects.toEqual(
		expect.objectContaining({ status: 400 })
	);
});

test('remove deletes the gallery row and the underlying attachment', async () => {
	const user = makeUser(ctx.kit);
	const place = makePlace(user.id);
	const [image] = await addGalleryImages(user.id, 'place', place.id, [pngFile()]);
	expect(ctx.kit.selectFrom(attachments).executeSync()).toHaveLength(1);

	await removeGalleryImage(user.id, image.id);
	expect(listGalleryImages('place', place.id)).toHaveLength(0);
	expect(ctx.kit.selectFrom(attachments).executeSync()).toHaveLength(0);
});

test('remove on a missing image is a 404', async () => {
	const user = makeUser(ctx.kit);
	await expect(removeGalleryImage(user.id, 999)).rejects.toEqual(
		expect.objectContaining({ status: 404 })
	);
});

test('reorder requires a full permutation and applies the new order', async () => {
	const user = makeUser(ctx.kit);
	const place = makePlace(user.id);
	const added = await addGalleryImages(user.id, 'place', place.id, [
		pngFile('a.png'),
		pngFile('b.png'),
		pngFile('c.png')
	]);
	const ids = added.map((i) => i.id);

	expect(() => reorderGallery(user.id, 'place', place.id, [ids[0], ids[1]])).toThrow(
		expect.objectContaining({ status: 400 })
	);
	expect(() => reorderGallery(user.id, 'place', place.id, [ids[0], ids[1], ids[1]])).toThrow(
		expect.objectContaining({ status: 400 })
	);
	expect(() => reorderGallery(user.id, 'place', place.id, [ids[0], ids[1], 999])).toThrow(
		expect.objectContaining({ status: 400 })
	);

	const reordered = reorderGallery(user.id, 'place', place.id, [ids[2], ids[0], ids[1]]);
	expect(reordered.map((i) => i.filename)).toEqual(['c.png', 'a.png', 'b.png']);
	expect(reordered.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
});

test('moveGalleryImage swaps neighbors and stops at the edges', async () => {
	const user = makeUser(ctx.kit);
	const place = makePlace(user.id);
	const added = await addGalleryImages(user.id, 'place', place.id, [
		pngFile('a.png'),
		pngFile('b.png')
	]);
	const [first, second] = added;

	expect(moveGalleryImage(user.id, first.id, 'earlier').map((i) => i.filename)).toEqual([
		'a.png',
		'b.png'
	]);
	expect(moveGalleryImage(user.id, first.id, 'later').map((i) => i.filename)).toEqual([
		'b.png',
		'a.png'
	]);
	// Current order is b, a: b is already at the front, so earlier is a no-op.
	expect(moveGalleryImage(user.id, second.id, 'earlier').map((i) => i.filename)).toEqual([
		'b.png',
		'a.png'
	]);
	// Moving a back to the front restores the original order.
	expect(moveGalleryImage(user.id, first.id, 'earlier').map((i) => i.filename)).toEqual([
		'a.png',
		'b.png'
	]);
});

test('captions validate length, trim, and clear to null', async () => {
	const user = makeUser(ctx.kit);
	const place = makePlace(user.id);
	const [image] = await addGalleryImages(user.id, 'place', place.id, [pngFile()]);

	const updated = setGalleryCaption(user.id, image.id, '  Sunset  ');
	expect(updated.caption).toBe('Sunset');
	expect(() => setGalleryCaption(user.id, image.id, 'x'.repeat(201))).toThrow(
		expect.objectContaining({ status: 400 })
	);
	expect(setGalleryCaption(user.id, image.id, '').caption).toBeNull();
});

test('place authorization: only the owner can read or write', async () => {
	const owner = makeUser(ctx.kit);
	const stranger = makeUser(ctx.kit);
	const place = makePlace(owner.id);

	await expect(addGalleryImages(stranger.id, 'place', place.id, [pngFile()])).rejects.toEqual(
		expect.objectContaining({ status: 404 })
	);
	expect(() => listGallery(stranger.id, 'place', place.id)).toThrow(
		expect.objectContaining({ status: 404 })
	);
	const [image] = await addGalleryImages(owner.id, 'place', place.id, [pngFile()]);
	await expect(removeGalleryImage(stranger.id, image.id)).rejects.toEqual(
		expect.objectContaining({ status: 404 })
	);
	expect(() => setGalleryCaption(stranger.id, image.id, 'nope')).toThrow(
		expect.objectContaining({ status: 404 })
	);
	expect(listGallery(owner.id, 'place', place.id)).toHaveLength(1);
});

test('trip authorization: owner and edit-share write, view-share reads only, stranger nothing', async () => {
	const owner = makeUser(ctx.kit);
	const editor = makeUser(ctx.kit);
	const viewer = makeUser(ctx.kit);
	const stranger = makeUser(ctx.kit);
	const trip = makeTrip(ctx.kit, owner.id);
	makeShare(ctx.kit, { tripId: trip.id, sharedWithUserId: editor.id, permission: 'edit' });
	makeShare(ctx.kit, { tripId: trip.id, sharedWithUserId: viewer.id, permission: 'read' });

	const [image] = await addGalleryImages(editor.id, 'trip', trip.id, [pngFile()]);
	expect(image.ownerType).toBe('trip');
	expect(listGallery(viewer.id, 'trip', trip.id)).toHaveLength(1);
	expect(listGallery(owner.id, 'trip', trip.id)).toHaveLength(1);

	await expect(addGalleryImages(viewer.id, 'trip', trip.id, [pngFile()])).rejects.toEqual(
		expect.objectContaining({ status: 404 })
	);
	await expect(removeGalleryImage(viewer.id, image.id)).rejects.toEqual(
		expect.objectContaining({ status: 404 })
	);
	expect(() => listGallery(stranger.id, 'trip', trip.id)).toThrow(
		expect.objectContaining({ status: 404 })
	);
	await expect(removeGalleryImage(stranger.id, image.id)).rejects.toEqual(
		expect.objectContaining({ status: 404 })
	);

	await removeGalleryImage(owner.id, image.id);
	expect(listGalleryImages('trip', trip.id)).toHaveLength(0);
});

test('first place upload sets the cover; removing the cover reassigns or clears it', async () => {
	const user = makeUser(ctx.kit);
	const place = makePlace(user.id);

	const added = await addGalleryImages(user.id, 'place', place.id, [
		pngFile('one.png'),
		pngFile('two.png')
	]);
	let reloaded = getPlaceById(place.id, user.id)!;
	expect(reloaded.imageAttachmentId).toBe(added[0].attachmentId);

	// Later uploads do not steal the cover.
	await addGalleryImages(user.id, 'place', place.id, [pngFile('three.png')]);
	reloaded = getPlaceById(place.id, user.id)!;
	expect(reloaded.imageAttachmentId).toBe(added[0].attachmentId);

	// Removing the cover promotes the next image in order.
	await removeGalleryImage(user.id, added[0].id);
	reloaded = getPlaceById(place.id, user.id)!;
	expect(reloaded.imageAttachmentId).toBe(added[1].attachmentId);

	await removeGalleryImage(user.id, added[1].id);
	const remaining = listGalleryImages('place', place.id);
	await removeGalleryImage(user.id, remaining[0].id);
	reloaded = getPlaceById(place.id, user.id)!;
	expect(reloaded.imageAttachmentId).toBeNull();
});

test('deletePlace cleans up gallery rows and attachments', async () => {
	const user = makeUser(ctx.kit);
	const place = makePlace(user.id);
	await addGalleryImages(user.id, 'place', place.id, [pngFile(), pngFile()]);
	expect(ctx.kit.selectFrom(attachments).executeSync()).toHaveLength(2);

	await deletePlace(place.id, user.id);
	expect(
		ctx.kit.selectFrom(galleryImages).where(kitEq(galleryImages.owner_type, 'place')).executeSync()
	).toHaveLength(0);
	expect(ctx.kit.selectFrom(attachments).executeSync()).toHaveLength(0);
});

test('deleteGalleryForOwner removes rows and attachments without auth (caller authorizes)', async () => {
	const user = makeUser(ctx.kit);
	const trip = makeTrip(ctx.kit, user.id);
	await addGalleryImages(user.id, 'trip', trip.id, [pngFile()]);

	const deleted = await deleteGalleryForOwner('trip', trip.id);
	expect(deleted).toHaveLength(1);
	expect(listGalleryImages('trip', trip.id)).toHaveLength(0);
	expect(ctx.kit.selectFrom(attachments).executeSync()).toHaveLength(0);
});

test('gallery is excluded from the viewer (shared/public) trip projection', async () => {
	const user = makeUser(ctx.kit);
	const trip = makeTrip(ctx.kit, user.id);
	await addGalleryImages(user.id, 'trip', trip.id, [pngFile()]);

	const projection = viewerProjection(
		{ ...trip, tags: '[]' } as never,
		[] as never,
		true
	) as Record<string, unknown>;
	expect('gallery' in projection).toBe(false);
	expect('galleryImages' in projection).toBe(false);
	expect(JSON.stringify(projection)).not.toContain('attachment');
});

test('MCP projection strips attachment internals', async () => {
	const user = makeUser(ctx.kit);
	const place = makePlace(user.id);
	const [image] = await addGalleryImages(user.id, 'place', place.id, [pngFile()]);
	const projected = projectGalleryImage(image) as Record<string, unknown>;
	expect(projected.attachmentId).toBeUndefined();
	expect(projected.storageKey).toBeUndefined();
	expect(projected.filename).toBe('photo.png');
});

test('writes log audit events', async () => {
	const user = makeUser(ctx.kit);
	const place = makePlace(user.id);
	const [image] = await addGalleryImages(user.id, 'place', place.id, [pngFile()]);
	await removeGalleryImage(user.id, image.id);

	const actions = ctx.kit
		.selectFrom(auditLogs)
		.executeSync()
		.map((r) => r.action);
	expect(actions).toContain('gallery_image_add');
	expect(actions).toContain('gallery_image_remove');
});
