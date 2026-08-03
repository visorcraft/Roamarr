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
	attachments,
	galleryImages,
	places,
	trips,
	users
} from '$lib/server/db/mongrelSchema';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';
import { makeSyncedUser } from '../../../../../../../tests/helpers';
import { validateOAuthUser } from '$lib/server/auth';
import { listGallery } from '$lib/server/gallery';
import { createPlace } from '$lib/server/places';
import { resetRateLimit } from '$lib/server/rateLimit';

// Real magic bytes so the attachment store's sniffing accepts the upload.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function pngFile(name = 'photo.png') {
	return new File([PNG_BYTES], name, { type: 'image/png' });
}

function getKit(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function event(opts: { user?: { id: number }; placeId: number | string; form?: FormData }) {
	const url = new URL(`http://localhost/api/mobile/places/${opts.placeId}/gallery`);
	return {
		locals: { user: opts.user ?? null },
		params: { id: String(opts.placeId) },
		url,
		getClientAddress: () => '127.0.0.1',
		request: opts.form
			? new Request(url, { method: 'POST', body: opts.form })
			: { method: 'POST', formData: async () => new FormData() }
	} as any;
}

let baseDir: string;
let originalAttachmentsPath: string | undefined;

beforeEach(() => {
	const kit = getKit();
	originalAttachmentsPath = process.env.ATTACHMENTS_PATH;
	baseDir = mkdtempSync(path.join(tmpdir(), 'roamarr-mobile-place-gallery-'));
	process.env.ATTACHMENTS_PATH = baseDir;
	kit.deleteFrom(galleryImages).executeSync();
	kit.deleteFrom(attachments).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(places).executeSync();
	kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

afterEach(() => {
	if (existsSync(baseDir)) rmSync(baseDir, { recursive: true, force: true });
	if (originalAttachmentsPath === undefined) delete process.env.ATTACHMENTS_PATH;
	else process.env.ATTACHMENTS_PATH = originalAttachmentsPath;
});

describe('mobile place gallery upload API', () => {
	test('owner uploads an image and the first image becomes the place cover', async () => {
		const kit = getKit();
		const row = makeSyncedUser(kit, { email: 'p@x.c', passwordHash: 'x', displayName: 'P' });
		const u = validateOAuthUser(row.id)!;
		const place = createPlace(u.id, { name: 'Overlook' });

		const form = new FormData();
		form.set('file', pngFile('view.png'));
		form.set('caption', 'Valley view');
		const res = await POST(event({ user: u, placeId: place.id, form }));
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.images).toHaveLength(1);
		expect(body.images[0]).toMatchObject({
			ownerType: 'place',
			ownerId: place.id,
			filename: 'view.png',
			caption: 'Valley view'
		});
		expect(listGallery(u.id, 'place', place.id)).toHaveLength(1);
	});

	test('a foreign place is a 404', async () => {
		const kit = getKit();
		const ownerRow = makeSyncedUser(kit, { email: 'owner@x.c', passwordHash: 'x', displayName: 'O' });
		const owner = validateOAuthUser(ownerRow.id)!;
		const otherRow = makeSyncedUser(kit, { email: 'other@x.c', passwordHash: 'x', displayName: 'T' });
		const other = validateOAuthUser(otherRow.id)!;
		const place = createPlace(owner.id, { name: 'Overlook' });

		const form = new FormData();
		form.set('file', pngFile());
		await expect(POST(event({ user: other, placeId: place.id, form }))).rejects.toMatchObject({
			status: 404
		});
	});

	test('POST requires an authenticated user', async () => {
		const kit = getKit();
		const row = makeSyncedUser(kit, { email: 'p2@x.c', passwordHash: 'x', displayName: 'P' });
		const u = validateOAuthUser(row.id)!;
		const place = createPlace(u.id, { name: 'Overlook' });
		const form = new FormData();
		form.set('file', pngFile());
		await expect(POST(event({ placeId: place.id, form }))).rejects.toMatchObject({ status: 401 });
	});

	test('rejects GPX uploads even though the attachment store allows them', async () => {
		const kit = getKit();
		const row = makeSyncedUser(kit, { email: 'p3@x.c', passwordHash: 'x', displayName: 'P' });
		const u = validateOAuthUser(row.id)!;
		const place = createPlace(u.id, { name: 'Trailhead' });
		const form = new FormData();
		form.set(
			'file',
			new File([new TextEncoder().encode('<?xml version="1.0"?><gpx></gpx>')], 'track.gpx', {
				type: 'application/gpx+xml'
			})
		);
		await expect(POST(event({ user: u, placeId: place.id, form }))).rejects.toMatchObject({
			status: 400
		});
		expect(listGallery(u.id, 'place', place.id)).toHaveLength(0);
	});
});
