import { test, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resetRateLimit } from '$lib/server/rateLimit';

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
	baseDir = mkdtempSync(path.join(tmpdir(), 'roamarr-places-'));
	process.env.ATTACHMENTS_PATH = baseDir;
	ctx.kit.deleteFrom(galleryImages).executeSync();
	ctx.kit.deleteFrom(attachments).executeSync();
	ctx.kit.deleteFrom(placeLinks).executeSync();
	ctx.kit.deleteFrom(places).executeSync();
	ctx.kit.deleteFrom(placeCategories).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
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

import { load, actions } from './+page.server';
import { places, placeCategories, placeLinks, galleryImages, attachments, auditLogs, users } from '$lib/server/db/mongrelSchema';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { makeUserLocals } from '../../../tests/eventHelpers';
import { makeUser } from '../../../tests/helpers';

function event(user: { id: number } | null, body?: FormData, url = 'http://localhost/places') {
	return {
		locals: { user } as App.Locals,
		request: body ? ({ formData: async () => body } as Request) : undefined,
		url: new URL(url),
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('load requires a signed-in user', () => {
	expect(() => load(event(null))).toThrow(expect.objectContaining({ status: 401 }));
});

test('load seeds default categories and lists only the user\'s places', () => {
	const user = makeUserLocals(ctx.kit);
	// makeUserLocals hardcodes one email; the second user must be distinct.
	const other = { user: makeUser(ctx.kit) };
	ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(other.user.id), name: 'Not yours' } as any)
		.executeSync();

	const data = load(event(user.user)) as any;
	expect(data.categories.length).toBe(8);
	expect(data.places).toHaveLength(0);
	// Maps are disabled by default in tests: no map config is emitted.
	expect(data.map).toBeNull();
});

test('savePlace creates a place, logs audit, and redirects', async () => {
	const user = makeUserLocals(ctx.kit);
	const f = new FormData();
	f.set('name', 'Eiffel Tower');
	f.set('address', 'Champ de Mars, Paris');
	f.set('lat', '48.8583');
	f.set('lng', '2.2945');
	f.set('durationMin', '120');
	f.set('price', '26.80');
	f.set('status', 'planned');
	f.set('favorite', 'on');

	await expect(actions.savePlace(event(user.user, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit
		.selectFrom(places)
		.where(kitEq(places.user_id, BigInt(user.user.id)))
		.executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].name).toBe('Eiffel Tower');
	expect(Number(rows[0].price)).toBe(2680);
	expect(Number(rows[0].duration_min)).toBe(120);
	expect(rows[0].favorite).toBe(true);
	expect(rows[0].lat).toBeCloseTo(48.8583);

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('place_create');
});

test('savePlace rejects invalid input with errors object', async () => {
	const user = makeUserLocals(ctx.kit);
	const f = new FormData();
	f.set('name', '');
	f.set('price', '-4');
	const result = (await actions.savePlace(event(user.user, f))) as {
		status: number;
		data: { errors: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.name).toBe('name is required');
	expect(result.data.errors.price).toBeTruthy();
	expect(ctx.kit.selectFrom(places).executeSync()).toHaveLength(0);
});

test('savePlace with an id updates only that user\'s place', async () => {
	const user = makeUserLocals(ctx.kit);
	// makeUserLocals hardcodes one email; the second user must be distinct.
	const other = { user: makeUser(ctx.kit) };
	const row = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(other.user.id), name: 'Foreign' } as any)
		.executeSync();

	const f = new FormData();
	f.set('id', String(Number(row.id)));
	f.set('name', 'Hijacked');
	// Ownership guard: another user's place is not found.
	const result = (await actions.savePlace(event(user.user, f))) as { status: number };
	expect(result.status).toBe(404);
	const after = ctx.kit.selectFrom(places).executeSync()[0];
	expect(after.name).toBe('Foreign');
});

test('toggleVisited and toggleFavorite flip state', async () => {
	const user = makeUserLocals(ctx.kit);
	const row = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(user.user.id), name: 'Trail' } as any)
		.executeSync();
	const id = String(Number(row.id));

	const f = new FormData();
	f.set('id', id);
	await expect(actions.toggleVisited(event(user.user, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);
	let rowAfter = ctx.kit.selectFrom(places).executeSync()[0];
	expect(rowAfter.status).toBe('visited');
	expect(rowAfter.visited_at).toBeTruthy();

	const f2 = new FormData();
	f2.set('id', id);
	await expect(actions.toggleFavorite(event(user.user, f2))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);
	rowAfter = ctx.kit.selectFrom(places).executeSync()[0];
	expect(rowAfter.favorite).toBe(true);
});

test('deletePlace removes only the user\'s own place', async () => {
	const user = makeUserLocals(ctx.kit);
	// makeUserLocals hardcodes one email; the second user must be distinct.
	const other = { user: makeUser(ctx.kit) };
	const row = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(other.user.id), name: 'Foreign' } as any)
		.executeSync();
	const f = new FormData();
	f.set('id', String(Number(row.id)));
	const result = (await actions.deletePlace(event(user.user, f))) as { status: number };
	expect(result.status).toBe(404);
	expect(ctx.kit.selectFrom(places).executeSync()).toHaveLength(1);
});

function gpxFile(name = 'track.gpx') {
	return new File(
		['<gpx version="1.1" creator="t"><trk><trkseg><trkpt lat="1" lon="2" /></trkseg></trk></gpx>'],
		name,
		{ type: 'application/gpx+xml' }
	);
}

test('uploadGpx requires a signed-in user', async () => {
	const f = new FormData();
	f.set('id', '1');
	f.set('file', gpxFile());
	await expect(actions.uploadGpx(event(null, f))).rejects.toEqual(
		expect.objectContaining({ status: 401 })
	);
});

test('uploadGpx attaches a track and replacing it deletes the old attachment', async () => {
	const user = makeUserLocals(ctx.kit);
	const row = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(user.user.id), name: 'Trailhead' } as any)
		.executeSync();
	const placeId = String(Number(row.id));

	const f = new FormData();
	f.set('id', placeId);
	f.set('file', gpxFile('one.gpx'));
	await expect(actions.uploadGpx(event(user.user, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	let place = ctx.kit.selectFrom(places).executeSync()[0];
	const firstAttachmentId = place.gpx_attachment_id;
	expect(firstAttachmentId).toBeTruthy();
	let attRows = ctx.kit.selectFrom(attachments).executeSync();
	expect(attRows).toHaveLength(1);
	expect(attRows[0]!.content_type).toBe('application/gpx+xml');

	// Replace: one GPX per place, old attachment is deleted.
	const f2 = new FormData();
	f2.set('id', placeId);
	f2.set('file', gpxFile('two.gpx'));
	await expect(actions.uploadGpx(event(user.user, f2))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);
	place = ctx.kit.selectFrom(places).executeSync()[0];
	expect(place.gpx_attachment_id).not.toBe(firstAttachmentId);
	attRows = ctx.kit.selectFrom(attachments).executeSync();
	expect(attRows).toHaveLength(1);
	expect(attRows[0]!.filename).toBe('two.gpx');
});

test('uploadGpx rejects another user\'s place and non-GPX files', async () => {
	const user = makeUserLocals(ctx.kit);
	const other = { user: makeUser(ctx.kit) };
	const row = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(other.user.id), name: 'Foreign' } as any)
		.executeSync();

	const f = new FormData();
	f.set('id', String(Number(row.id)));
	f.set('file', gpxFile());
	const foreign = (await actions.uploadGpx(event(user.user, f))) as { status: number };
	expect(foreign.status).toBe(404);
	expect(ctx.kit.selectFrom(attachments).executeSync()).toHaveLength(0);

	// Ownership passes for own place but the payload is not GPX.
	const own = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(user.user.id), name: 'Mine' } as any)
		.executeSync();
	const f2 = new FormData();
	f2.set('id', String(Number(own.id)));
	f2.set('file', new File(['plain text'], 'notes.txt', { type: 'text/plain' }));
	await expect(actions.uploadGpx(event(user.user, f2))).rejects.toEqual(
		expect.objectContaining({ status: 400 })
	);
});

test('removeGpx detaches and deletes the attachment', async () => {
	const user = makeUserLocals(ctx.kit);
	const row = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(user.user.id), name: 'Trailhead' } as any)
		.executeSync();
	const placeId = String(Number(row.id));

	const f = new FormData();
	f.set('id', placeId);
	f.set('file', gpxFile());
	await expect(actions.uploadGpx(event(user.user, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);
	expect(ctx.kit.selectFrom(attachments).executeSync()).toHaveLength(1);

	const f2 = new FormData();
	f2.set('id', placeId);
	await expect(actions.removeGpx(event(user.user, f2))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);
	const place = ctx.kit.selectFrom(places).executeSync()[0];
	expect(place.gpx_attachment_id).toBeNull();
	expect(ctx.kit.selectFrom(attachments).executeSync()).toHaveLength(0);
});

test('removeGpx on another user\'s place returns 404', async () => {
	const user = makeUserLocals(ctx.kit);
	const other = { user: makeUser(ctx.kit) };
	const row = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(other.user.id), name: 'Foreign' } as any)
		.executeSync();
	const f = new FormData();
	f.set('id', String(Number(row.id)));
	const result = (await actions.removeGpx(event(user.user, f))) as { status: number };
	expect(result.status).toBe(404);
});

test('createCategory and deleteCategory manage categories', async () => {
	const user = makeUserLocals(ctx.kit);
	const f = new FormData();
	f.set('name', 'Hidden gems');
	f.set('color', '#123abc');
	await expect(actions.createCategory(event(user.user, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);
	const cats = ctx.kit
		.selectFrom(placeCategories)
		.where(kitEq(placeCategories.user_id, BigInt(user.user.id)))
		.executeSync();
	expect(cats.map((c) => c.name)).toContain('Hidden gems');

	const target = cats.find((c) => c.name === 'Hidden gems')!;
	const f2 = new FormData();
	f2.set('id', String(Number(target.id)));
	await expect(actions.deleteCategory(event(user.user, f2))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);
	const remaining = ctx.kit
		.selectFrom(placeCategories)
		.where(kitEq(placeCategories.user_id, BigInt(user.user.id)))
		.executeSync();
	expect(remaining.map((c) => c.name)).not.toContain('Hidden gems');
});

test('saveLink creates a link and load groups links by place', async () => {
	const user = makeUserLocals(ctx.kit);
	const row = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(user.user.id), name: 'Cafe' } as any)
		.executeSync();
	const placeId = String(Number(row.id));

	const f = new FormData();
	f.set('id', placeId);
	f.set('label', 'Menu');
	f.set('url', 'https://cafe.example/menu');
	f.set('notes', 'Seasonal');
	await expect(actions.saveLink(event(user.user, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const links = ctx.kit.selectFrom(placeLinks).executeSync();
	expect(links).toHaveLength(1);
	expect(links[0].label).toBe('Menu');
	expect(links[0].notes).toBe('Seasonal');

	const data = load(event(user.user)) as any;
	const listed = data.linksByPlace[Number(row.id)];
	expect(listed).toHaveLength(1);
	expect(listed[0].url).toBe('https://cafe.example/menu');
});

test('saveLink requires a signed-in user', async () => {
	const f = new FormData();
	f.set('id', '1');
	f.set('label', 'X');
	f.set('url', 'https://a.example');
	await expect(actions.saveLink(event(null, f))).rejects.toEqual(
		expect.objectContaining({ status: 401 })
	);
});

test('saveLink rejects invalid URLs and foreign places', async () => {
	const user = makeUserLocals(ctx.kit);
	const own = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(user.user.id), name: 'Mine' } as any)
		.executeSync();

	const bad = new FormData();
	bad.set('id', String(Number(own.id)));
	bad.set('label', 'X');
	bad.set('url', 'javascript:alert(1)');
	const invalid = (await actions.saveLink(event(user.user, bad))) as {
		status: number;
		data: { errors: Record<string, string> };
	};
	expect(invalid.status).toBe(400);
	expect(invalid.data.errors.url).toBeTruthy();

	// Another user's place is not found.
	const other = { user: makeUser(ctx.kit) };
	const foreign = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(other.user.id), name: 'Foreign' } as any)
		.executeSync();
	const hijack = new FormData();
	hijack.set('id', String(Number(foreign.id)));
	hijack.set('label', 'X');
	hijack.set('url', 'https://a.example');
	expect(((await actions.saveLink(event(user.user, hijack))) as { status: number }).status).toBe(404);
	expect(ctx.kit.selectFrom(placeLinks).executeSync()).toHaveLength(0);
});

test('saveLink with a linkId edits only a link of that place', async () => {
	const user = makeUserLocals(ctx.kit);
	const placeA = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(user.user.id), name: 'A' } as any)
		.executeSync();
	const placeB = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(user.user.id), name: 'B' } as any)
		.executeSync();

	const create = new FormData();
	create.set('id', String(Number(placeA.id)));
	create.set('label', 'Old');
	create.set('url', 'https://old.example');
	await expect(actions.saveLink(event(user.user, create))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);
	const link = ctx.kit.selectFrom(placeLinks).executeSync()[0]!;

	const edit = new FormData();
	edit.set('id', String(Number(placeA.id)));
	edit.set('linkId', String(Number(link.id)));
	edit.set('label', 'New');
	edit.set('url', 'https://new.example');
	await expect(actions.saveLink(event(user.user, edit))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);
	expect(ctx.kit.selectFrom(placeLinks).executeSync()[0]!.label).toBe('New');

	// Cross-place link id is rejected.
	const cross = new FormData();
	cross.set('id', String(Number(placeB.id)));
	cross.set('linkId', String(Number(link.id)));
	cross.set('label', 'Hijack');
	cross.set('url', 'https://evil.example');
	expect(((await actions.saveLink(event(user.user, cross))) as { status: number }).status).toBe(404);
});

test('deleteLink removes only the owned place link', async () => {
	const user = makeUserLocals(ctx.kit);
	const other = { user: makeUser(ctx.kit) };
	const foreignPlace = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(other.user.id), name: 'Foreign' } as any)
		.executeSync();
	const link = ctx.kit
		.insertInto(placeLinks)
		.values({ place_id: foreignPlace.id, label: 'L', url: 'https://a.example' } as any)
		.executeSync();

	const f = new FormData();
	f.set('id', String(Number(foreignPlace.id)));
	f.set('linkId', String(Number(link.id)));
	expect(((await actions.deleteLink(event(user.user, f))) as { status: number }).status).toBe(404);
	expect(ctx.kit.selectFrom(placeLinks).executeSync()).toHaveLength(1);

	const ownPlace = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(user.user.id), name: 'Mine' } as any)
		.executeSync();
	const f2 = new FormData();
	f2.set('id', String(Number(ownPlace.id)));
	f2.set('linkId', String(Number(link.id)));
	// Link belongs to a different place: rejected before the row is touched.
	expect(((await actions.deleteLink(event(user.user, f2))) as { status: number }).status).toBe(404);

	const f3 = new FormData();
	f3.set('id', String(Number(foreignPlace.id)));
	f3.set('linkId', String(Number(link.id)));
	await expect(actions.deleteLink(event(other.user, f3))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);
	expect(ctx.kit.selectFrom(placeLinks).executeSync()).toHaveLength(0);
});

// Real PNG magic bytes so the attachment store's sniffing accepts the file.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function pngFile(name = 'photo.png') {
	return new File([PNG_BYTES], name, { type: 'image/png' });
}

function galleryForm(placeId: number | bigint, ...files: File[]) {
	const f = new FormData();
	f.set('id', String(placeId));
	for (const file of files) f.append('images', file);
	return f;
}

test('load returns gallery view models for each place', async () => {
	const user = makeUserLocals(ctx.kit);
	const row = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(user.user.id), name: 'Gallery spot' } as any)
		.executeSync();
	await expect(
		actions.uploadGalleryImages(
			event(user.user, galleryForm(row.id, pngFile('one.png'), pngFile('two.png')))
		)
	).rejects.toEqual(expect.objectContaining({ status: 303 }));

	const data = load(event(user.user)) as any;
	const images = data.galleries[Number(row.id)];
	expect(images).toHaveLength(2);
	expect(images[0].url).toBe(`/places/${Number(row.id)}/gallery/${images[0].id}`);
	expect(images[0].filename).toBe('one.png');
});

test('uploadGalleryImages rejects non-images and foreign places', async () => {
	const user = makeUserLocals(ctx.kit);
	const other = { user: makeUser(ctx.kit) };
	const foreign = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(other.user.id), name: 'Foreign' } as any)
		.executeSync();

	const notFound = (await actions.uploadGalleryImages(
		event(user.user, galleryForm(foreign.id, pngFile()))
	)) as { status: number };
	expect(notFound.status).toBe(404);

	const own = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(user.user.id), name: 'Mine' } as any)
		.executeSync();
	const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'doc.pdf', {
		type: 'application/pdf'
	});
	await expect(actions.uploadGalleryImages(event(user.user, galleryForm(own.id, pdf)))).rejects.toEqual(
		expect.objectContaining({ status: 400 })
	);
	const gpx = galleryForm(own.id, gpxFile());
	await expect(actions.uploadGalleryImages(event(user.user, gpx))).rejects.toEqual(
		expect.objectContaining({ status: 400 })
	);
	expect(ctx.kit.selectFrom(galleryImages).executeSync()).toHaveLength(0);
});

test('uploadGalleryImages enforces the 50-image cap per place', async () => {
	const user = makeUserLocals(ctx.kit);
	const own = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(user.user.id), name: 'Capped' } as any)
		.executeSync();
	// Seed 49 images directly; the action then rejects a 2-image batch.
	for (let i = 0; i < 49; i++) {
		const att = ctx.kit
			.insertInto(attachments)
			.values({
				owner_id: BigInt(user.user.id),
				storage_key: `cap-${i}`,
				filename: `cap-${i}.png`,
				content_type: 'image/png',
				size_bytes: 1n,
				context: '{}'
			} as any)
			.executeSync();
		ctx.kit
			.insertInto(galleryImages)
			.values({
				owner_type: 'place',
				owner_id: own.id,
				attachment_id: att.id,
				sort_order: BigInt(i)
			} as any)
			.executeSync();
	}
	await expect(
		actions.uploadGalleryImages(event(user.user, galleryForm(own.id, pngFile('a.png'), pngFile('b.png'))))
	).rejects.toEqual(expect.objectContaining({ status: 400 }));
	// A single image still fits exactly at the cap.
	await expect(
		actions.uploadGalleryImages(event(user.user, galleryForm(own.id, pngFile('a.png'))))
	).rejects.toEqual(expect.objectContaining({ status: 303 }));
	expect(ctx.kit.selectFrom(galleryImages).executeSync()).toHaveLength(50);
});

test('gallery image mutations require ownership and a matching place', async () => {
	const user = makeUserLocals(ctx.kit);
	const other = { user: makeUser(ctx.kit) };
	const own = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(user.user.id), name: 'Mine' } as any)
		.executeSync();
	const foreign = ctx.kit
		.insertInto(places)
		.values({ user_id: BigInt(other.user.id), name: 'Foreign' } as any)
		.executeSync();
	await expect(
		actions.uploadGalleryImages(event(user.user, galleryForm(own.id, pngFile())))
	).rejects.toEqual(expect.objectContaining({ status: 303 }));
	const image = ctx.kit.selectFrom(galleryImages).executeSync()[0]!;

	// Cross-place image id is rejected.
	const f = new FormData();
	f.set('id', String(Number(foreign.id)));
	f.set('imageId', String(Number(image.id)));
	f.set('direction', 'later');
	expect(((await actions.removeGalleryImage(event(user.user, f))) as { status: number }).status).toBe(404);
	expect(((await actions.setGalleryCaption(event(user.user, f))) as { status: number }).status).toBe(404);
	expect(((await actions.moveGalleryImage(event(user.user, f))) as { status: number }).status).toBe(404);

	// Foreign place id is rejected before touching the image.
	const f2 = new FormData();
	f2.set('id', String(Number(foreign.id)));
	f2.set('imageId', String(Number(image.id)));
	f2.set('caption', 'hijack');
	expect(((await actions.setGalleryCaption(event(user.user, f2))) as { status: number }).status).toBe(404);
	expect(ctx.kit.selectFrom(galleryImages).executeSync()[0]!.caption).toBeNull();

	// Owner can caption, move (single image: no-op), and remove.
	const f3 = new FormData();
	f3.set('id', String(Number(own.id)));
	f3.set('imageId', String(Number(image.id)));
	f3.set('caption', 'Sunset');
	await expect(actions.setGalleryCaption(event(user.user, f3))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);
	expect(ctx.kit.selectFrom(galleryImages).executeSync()[0]!.caption).toBe('Sunset');

	const f4 = new FormData();
	f4.set('id', String(Number(own.id)));
	f4.set('imageId', String(Number(image.id)));
	await expect(actions.removeGalleryImage(event(user.user, f4))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);
	expect(ctx.kit.selectFrom(galleryImages).executeSync()).toHaveLength(0);
	expect(ctx.kit.selectFrom(attachments).executeSync()).toHaveLength(0);
});
