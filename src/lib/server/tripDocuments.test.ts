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

import {
	addTripDocument,
	deleteTripDocument,
	listTripDocuments,
	listSegmentDocuments,
	readTripDocument
} from './tripDocuments';
import { tripDocuments, trips, users, segments } from './db/mongrelSchema';
import { eq, type KitDatabase } from '@visorcraft/mongreldb-kit';
import { makeSyncedUser, makeSyncedTrip, makeShare, streamToBuffer } from '../../../tests/helpers';
import { addSegment } from './segments';

function fileFromString(s: string, name: string, type: 'image/png' | 'application/pdf' = 'image/png') {
	const prefixes: Record<string, Uint8Array> = {
		'image/png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		'application/pdf': new Uint8Array([0x25, 0x50, 0x44, 0x46])
	};
	const prefix = prefixes[type]!;
	return new File([Buffer.concat([prefix, Buffer.from(s)])], name, { type });
}

function getKit(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

let baseDir: string;
let originalAttachmentsPath: string | undefined;

beforeEach(() => {
	const kit = getKit();
	originalAttachmentsPath = process.env.ATTACHMENTS_PATH;
	baseDir = mkdtempSync(path.join(tmpdir(), 'roamarr-trip-doc-'));
	process.env.ATTACHMENTS_PATH = baseDir;
	kit.deleteFrom(tripDocuments).executeSync();
	kit.deleteFrom(segments).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
});

afterEach(() => {
	if (existsSync(baseDir)) rmSync(baseDir, { recursive: true, force: true });
	if (originalAttachmentsPath === undefined) {
		delete process.env.ATTACHMENTS_PATH;
	} else {
		process.env.ATTACHMENTS_PATH = originalAttachmentsPath;
	}
});

function seed() {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'docs@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	return { kit, u, t };
}

test('addTripDocument stores trip-level file', async () => {
	const { kit, u, t } = seed();
	const { link, attachment } = await addTripDocument(u.id, t.id, {
		file: fileFromString('qr-code', 'shuttle-qr.png'),
		label: 'Shuttle QR'
	});

	expect(attachment.filename).toBe('shuttle-qr.png');
	expect(link.tripId).toBe(t.id);
	expect(link.segmentId).toBeNull();
	expect(link.label).toBe('Shuttle QR');

	const rows = kit
		.selectFrom(tripDocuments)
		.where(eq(tripDocuments.trip_id, BigInt(t.id)))
		.executeSync();
	expect(rows).toHaveLength(1);

	const listed = listTripDocuments(t.id);
	expect(listed).toHaveLength(1);
	expect(listed[0]!.label).toBe('Shuttle QR');
	expect(listed[0]!.filename).toBe('shuttle-qr.png');
});

test('addTripDocument attaches to a segment', async () => {
	const { u, t } = seed();
	const seg = addSegment(u.id, t.id, {
		type: 'event',
		title: 'Massage',
		localStart: '2026-09-01T09:00',
		startTz: 'Asia/Bangkok'
	});

	const { link } = await addTripDocument(u.id, t.id, {
		file: fileFromString('ticket', 'voucher.pdf', 'application/pdf'),
		segmentId: Number(seg.id),
		label: 'Voucher'
	});

	expect(link.segmentId).toBe(Number(seg.id));
	expect(listSegmentDocuments(Number(seg.id))).toHaveLength(1);
	expect(listTripDocuments(t.id)[0]!.segmentId).toBe(Number(seg.id));
});

test('addTripDocument accepts a GPX track file', async () => {
	const { u, t } = seed();
	const seg = addSegment(u.id, t.id, {
		type: 'event',
		title: 'Hike',
		localStart: '2026-09-01T09:00',
		startTz: 'Asia/Bangkok'
	});
	const gpx = '<gpx version="1.1" creator="t"><trk><trkseg><trkpt lat="1" lon="2" /></trkseg></trk></gpx>';
	const file = new File([gpx], 'trail.gpx', { type: 'text/xml' });
	const { link, attachment } = await addTripDocument(u.id, t.id, {
		file,
		segmentId: Number(seg.id)
	});

	expect(attachment.contentType).toBe('application/gpx+xml');
	expect(link.segmentId).toBe(Number(seg.id));
	const listed = listSegmentDocuments(Number(seg.id));
	expect(listed).toHaveLength(1);
	expect(listed[0]!.contentType).toBe('application/gpx+xml');
});

test('addTripDocument rejects segment from another trip', async () => {
	const { kit, u, t } = seed();
	const other = makeSyncedTrip(kit, { ownerId: u.id, name: 'Other' });
	const seg = addSegment(u.id, other.id, {
		type: 'note',
		title: 'N',
		localStart: '2026-09-01T09:00',
		startTz: 'UTC'
	});

	await expect(
		addTripDocument(u.id, t.id, {
			file: fileFromString('x', 'x.png'),
			segmentId: Number(seg.id)
		})
	).rejects.toMatchObject({ status: 400 });
});

test('readTripDocument decrypts payload', async () => {
	const { u, t } = seed();
	const { link } = await addTripDocument(u.id, t.id, {
		file: fileFromString('secret voucher', 'v.png')
	});
	const { stream, record } = await readTripDocument(u.id, link.id);
	const out = await streamToBuffer(stream);
	expect(record.filename).toBe('v.png');
	expect(out.toString('utf8')).toContain('secret voucher');
});

test('deleteTripDocument removes link', async () => {
	const { kit, u, t } = seed();
	const { link } = await addTripDocument(u.id, t.id, {
		file: fileFromString('gone', 'g.png')
	});
	await deleteTripDocument(u.id, link.id);
	expect(
		kit.selectFrom(tripDocuments).where(eq(tripDocuments.id, BigInt(link.id))).executeSync()[0]
	).toBeUndefined();
	await expect(readTripDocument(u.id, link.id)).rejects.toMatchObject({ status: 404 });
});

test('non-editor cannot upload', async () => {
	const { kit, u, t } = seed();
	const other = makeSyncedUser(kit, { email: 'other@x.c', passwordHash: 'x', displayName: 'O' });
	await expect(
		addTripDocument(other.id, t.id, { file: fileFromString('x', 'x.png') })
	).rejects.toMatchObject({ status: 404 });
});

test('read share can download but not upload', async () => {
	const { kit, u, t } = seed();
	const viewer = makeSyncedUser(kit, { email: 'v@x.c', passwordHash: 'x', displayName: 'V' });
	makeShare(kit, { tripId: t.id, sharedWithUserId: viewer.id, permission: 'read' });
	const { link } = await addTripDocument(u.id, t.id, {
		file: fileFromString('shared', 's.png')
	});
	const { stream } = await readTripDocument(viewer.id, link.id);
	expect((await streamToBuffer(stream)).toString('utf8')).toContain('shared');
	await expect(
		addTripDocument(viewer.id, t.id, { file: fileFromString('no', 'n.png') })
	).rejects.toMatchObject({ status: 404 });
});
