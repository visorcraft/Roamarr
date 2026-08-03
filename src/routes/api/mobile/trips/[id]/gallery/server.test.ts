import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { POST } from './+server';
import {
	auditLogs,
	attachments,
	galleryImages,
	places,
	tripShares,
	trips,
	users
} from '$lib/server/db/mongrelSchema';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';
import {
	makeShare,
	makeSyncedTrip,
	makeSyncedUser
} from '../../../../../../../tests/helpers';
import { validateOAuthUser } from '$lib/server/auth';
import { listGallery, MAX_GALLERY_IMAGES } from '$lib/server/gallery';
import { resetRateLimit } from '$lib/server/rateLimit';

// Real magic bytes so the attachment store's sniffing accepts the upload.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function pngFile(name = 'photo.png') {
	return new File([PNG_BYTES], name, { type: 'image/png' });
}

function getKit(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function event(opts: { user?: { id: number }; tripId: number | string; form?: FormData }) {
	const url = new URL(`http://localhost/api/mobile/trips/${opts.tripId}/gallery`);
	return {
		locals: { user: opts.user ?? null },
		params: { id: String(opts.tripId) },
		url,
		getClientAddress: () => '127.0.0.1',
		request: opts.form
			? new Request(url, { method: 'POST', body: opts.form })
			: { method: 'POST', formData: async () => new FormData() }
	} as any;
}

function seedGalleryToCap(userId: number, tripId: number) {
	const kit = getKit();
	for (let i = 0; i < MAX_GALLERY_IMAGES; i++) {
		const att = kit
			.insertInto(attachments)
			.values({
				owner_id: BigInt(userId),
				storage_key: `seed-${i}`,
				filename: `seed-${i}.png`,
				content_type: 'image/png',
				size_bytes: 1n,
				context: '{}'
			} as never)
			.executeSync();
		kit.insertInto(galleryImages)
			.values({
				owner_type: 'trip',
				owner_id: BigInt(tripId),
				attachment_id: att.id,
				sort_order: BigInt(i)
			} as never)
			.executeSync();
	}
}

let baseDir: string;
let originalAttachmentsPath: string | undefined;

beforeEach(() => {
	const kit = getKit();
	originalAttachmentsPath = process.env.ATTACHMENTS_PATH;
	baseDir = mkdtempSync(path.join(tmpdir(), 'roamarr-mobile-gallery-'));
	process.env.ATTACHMENTS_PATH = baseDir;
	kit.deleteFrom(galleryImages).executeSync();
	kit.deleteFrom(attachments).executeSync();
	kit.deleteFrom(tripShares).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(places).executeSync();
	kit.deleteFrom(auditLogs).executeSync();
	kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

afterEach(() => {
	if (existsSync(baseDir)) rmSync(baseDir, { recursive: true, force: true });
	if (originalAttachmentsPath === undefined) delete process.env.ATTACHMENTS_PATH;
	else process.env.ATTACHMENTS_PATH = originalAttachmentsPath;
});

describe('mobile trip gallery upload API', () => {
	test('POST uploads an image with a caption and audits the add', async () => {
		const kit = getKit();
		const row = makeSyncedUser(kit, { email: 'g@x.c', passwordHash: 'x', displayName: 'G' });
		const u = validateOAuthUser(row.id)!;
		const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

		const form = new FormData();
		form.set('file', pngFile('sunset.png'));
		form.set('caption', 'Sunset over the bay');
		const res = await POST(event({ user: u, tripId: t.id, form }));
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.images).toHaveLength(1);
		expect(body.images[0]).toMatchObject({
			ownerType: 'trip',
			ownerId: t.id,
			filename: 'sunset.png',
			contentType: 'image/png',
			caption: 'Sunset over the bay'
		});

		expect(listGallery(u.id, 'trip', t.id)).toHaveLength(1);
		const audit = kit.selectFrom(auditLogs).executeSync();
		expect(audit.some((log) => log.action === 'gallery_image_add')).toBe(true);
		expect(audit.some((log) => log.action === 'gallery_image_caption')).toBe(true);
	});

	test('POST requires an authenticated user', async () => {
		const kit = getKit();
		const row = makeSyncedUser(kit, { email: 'g2@x.c', passwordHash: 'x', displayName: 'G' });
		const u = validateOAuthUser(row.id)!;
		const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
		const form = new FormData();
		form.set('file', pngFile());
		await expect(POST(event({ tripId: t.id, form }))).rejects.toMatchObject({ status: 401 });
	});

	test('edit shares can upload but read shares cannot', async () => {
		const kit = getKit();
		const ownerRow = makeSyncedUser(kit, { email: 'owner@x.c', passwordHash: 'x', displayName: 'O' });
		const owner = validateOAuthUser(ownerRow.id)!;
		const t = makeSyncedTrip(kit, { ownerId: owner.id, name: 'T' });
		const viewerRow = makeSyncedUser(kit, { email: 'viewer@x.c', passwordHash: 'x', displayName: 'V' });
		const viewer = validateOAuthUser(viewerRow.id)!;
		const editorRow = makeSyncedUser(kit, { email: 'editor@x.c', passwordHash: 'x', displayName: 'E' });
		const editor = validateOAuthUser(editorRow.id)!;
		makeShare(kit, { tripId: t.id, sharedWithUserId: viewer.id, permission: 'read' });
		makeShare(kit, { tripId: t.id, sharedWithUserId: editor.id, permission: 'edit' });

		const denied = new FormData();
		denied.set('file', pngFile());
		await expect(POST(event({ user: viewer, tripId: t.id, form: denied }))).rejects.toMatchObject({
			status: 404
		});

		const allowed = new FormData();
		allowed.set('file', pngFile());
		const res = await POST(event({ user: editor, tripId: t.id, form: allowed }));
		expect(res.status).toBe(201);
	});

	test('rejects non-image uploads like PDF', async () => {
		const kit = getKit();
		const row = makeSyncedUser(kit, { email: 'g3@x.c', passwordHash: 'x', displayName: 'G' });
		const u = validateOAuthUser(row.id)!;
		const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
		const form = new FormData();
		form.set('file', new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'doc.pdf', { type: 'application/pdf' }));
		await expect(POST(event({ user: u, tripId: t.id, form }))).rejects.toMatchObject({
			status: 400
		});
		expect(listGallery(u.id, 'trip', t.id)).toHaveLength(0);
	});

	test('enforces the per-gallery image cap', async () => {
		const kit = getKit();
		const row = makeSyncedUser(kit, { email: 'g4@x.c', passwordHash: 'x', displayName: 'G' });
		const u = validateOAuthUser(row.id)!;
		const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
		seedGalleryToCap(u.id, t.id);

		const form = new FormData();
		form.set('file', pngFile());
		await expect(POST(event({ user: u, tripId: t.id, form }))).rejects.toMatchObject({
			status: 400
		});
	});

	test('rejects an overlong caption without uploading', async () => {
		const kit = getKit();
		const row = makeSyncedUser(kit, { email: 'g5@x.c', passwordHash: 'x', displayName: 'G' });
		const u = validateOAuthUser(row.id)!;
		const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
		const form = new FormData();
		form.set('file', pngFile());
		form.set('caption', 'x'.repeat(201));
		await expect(POST(event({ user: u, tripId: t.id, form }))).rejects.toMatchObject({
			status: 400
		});
		expect(listGallery(u.id, 'trip', t.id)).toHaveLength(0);
	});
});
