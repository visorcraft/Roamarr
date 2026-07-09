import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { attachments, trips, users } from './db/mongrelSchema';
import { eq, type KitDatabase } from '@visorcraft/mongreldb-kit';
import { makeSyncedTrip, makeSyncedUser, streamToBuffer } from '../../../tests/helpers';
import { readTripPoster, uploadTripPoster } from './tripPoster';

function getKit(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function imageFile(body = 'poster') {
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	return new File([Buffer.concat([png, Buffer.from(body)])], 'poster.png', { type: 'image/png' });
}

let baseDir: string;
let originalAttachmentsPath: string | undefined;

beforeEach(() => {
	const kit = getKit();
	originalAttachmentsPath = process.env.ATTACHMENTS_PATH;
	baseDir = mkdtempSync(path.join(tmpdir(), 'roamarr-trip-poster-'));
	process.env.ATTACHMENTS_PATH = baseDir;
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(attachments).executeSync();
	kit.deleteFrom(users).executeSync();
});

afterEach(() => {
	if (existsSync(baseDir)) rmSync(baseDir, { recursive: true, force: true });
	if (originalAttachmentsPath === undefined) delete process.env.ATTACHMENTS_PATH;
	else process.env.ATTACHMENTS_PATH = originalAttachmentsPath;
});

test('uploadTripPoster stores and reads the selected image', async () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'poster@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

	const attachment = await uploadTripPoster(u.id, t.id, imageFile('hello'));

	const row = kit.selectFrom(trips).where(eq(trips.id, BigInt(t.id))).executeSync()[0];
	expect(Number(row.poster_attachment_id)).toBe(attachment.id);

	const { stream, record } = await readTripPoster(u.id, t.id);
	expect(record.contentType).toBe('image/png');
	expect((await streamToBuffer(stream)).toString('utf8')).toContain('hello');
});

test('uploadTripPoster rejects non-images', async () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'poster-pdf@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

	const pdf = new File([Buffer.from('%PDF-1.4')], 'poster.pdf', { type: 'application/pdf' });
	await expect(uploadTripPoster(u.id, t.id, pdf)).rejects.toMatchObject({ status: 400 });
});
