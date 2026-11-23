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

import { GET, POST } from './+server';
import { GET as GET_ONE, DELETE } from './[docId]/+server';
import { tripDocuments, trips, users, segments, tripShares } from '$lib/server/db/mongrelSchema';
import { createShare } from '$lib/server/repositories/tripsRepo';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';
import { makeSyncedUser, makeSyncedTrip } from '../../../../../../../tests/helpers';
import { addSegment } from '$lib/server/segments';
import { validateOAuthUser } from '$lib/server/auth';

function fileFromString(s: string, name: string, type: 'image/png' | 'application/pdf' = 'image/png') {
	const prefixes: Record<string, Uint8Array> = {
		'image/png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		'application/pdf': new Uint8Array([0x25, 0x50, 0x44, 0x46])
	};
	return new File([Buffer.concat([prefixes[type]!, Buffer.from(s)])], name, { type });
}

function getKit(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function event(opts: {
	user: { id: number };
	params: Record<string, string>;
	url?: string;
	method?: string;
	form?: FormData;
}) {
	const url = new URL(opts.url ?? `http://localhost/api/mobile/trips/${opts.params.id}/documents`);
	return {
		locals: { user: opts.user },
		params: opts.params,
		url,
		request: opts.form
			? new Request(url, { method: opts.method ?? 'POST', body: opts.form })
			: { method: opts.method ?? 'GET', formData: async () => new FormData() }
	} as any;
}

let baseDir: string;
let originalAttachmentsPath: string | undefined;

beforeEach(() => {
	const kit = getKit();
	originalAttachmentsPath = process.env.ATTACHMENTS_PATH;
	baseDir = mkdtempSync(path.join(tmpdir(), 'roamarr-mobile-docs-'));
	process.env.ATTACHMENTS_PATH = baseDir;
	kit.deleteFrom(tripDocuments).executeSync();
	kit.deleteFrom(segments).executeSync();
	kit.deleteFrom(tripShares).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
});

afterEach(() => {
	if (existsSync(baseDir)) rmSync(baseDir, { recursive: true, force: true });
	if (originalAttachmentsPath === undefined) delete process.env.ATTACHMENTS_PATH;
	else process.env.ATTACHMENTS_PATH = originalAttachmentsPath;
});

describe('mobile trip documents API', () => {
	test('POST uploads and GET lists trip documents', async () => {
		const kit = getKit();
		const row = makeSyncedUser(kit, { email: 'm@x.c', passwordHash: 'x', displayName: 'M' });
		const u = validateOAuthUser(row.id)!;
		const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

		const form = new FormData();
		form.set('file', fileFromString('qr', 'qr.png'));
		form.set('label', 'Shuttle QR');
		const create = await POST(
			event({ user: u, params: { id: String(t.id) }, method: 'POST', form })
		);
		expect(create.status).toBe(201);
		const created = await create.json();
		expect(created.label).toBe('Shuttle QR');

		const list = await GET(event({ user: u, params: { id: String(t.id) } }));
		const body = await list.json();
		expect(body.rows).toHaveLength(1);
		expect(body.rows[0].filename).toBe('qr.png');

		const download = await GET_ONE(
			event({
				user: u,
				params: { id: String(t.id), docId: String(created.id) },
				url: `http://localhost/api/mobile/trips/${t.id}/documents/${created.id}`
			})
		);
		expect(download.status).toBe(200);
		expect(download.headers.get('content-type')).toBe('image/png');

		const del = await DELETE(
			event({
				user: u,
				params: { id: String(t.id), docId: String(created.id) },
				method: 'DELETE',
				url: `http://localhost/api/mobile/trips/${t.id}/documents/${created.id}`
			})
		);
		expect(del.status).toBe(204);
	});

	test('POST can scope a file to a segment', async () => {
		const kit = getKit();
		const row = makeSyncedUser(kit, { email: 's@x.c', passwordHash: 'x', displayName: 'S' });
		const u = validateOAuthUser(row.id)!;
		const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
		const seg = addSegment(u.id, t.id, {
			type: 'shuttle',
			title: 'Airport transfer',
			localStart: '2026-09-01T10:00',
			startTz: 'Asia/Bangkok'
		});

		const form = new FormData();
		form.set('file', fileFromString('voucher', 'v.pdf', 'application/pdf'));
		form.set('segmentId', String(seg.id));
		const create = await POST(
			event({ user: u, params: { id: String(t.id) }, method: 'POST', form })
		);
		const created = await create.json();
		expect(created.segmentId).toBe(Number(seg.id));

		const filtered = await GET(
			event({
				user: u,
				params: { id: String(t.id) },
				url: `http://localhost/api/mobile/trips/${t.id}/documents?segmentId=${seg.id}`
			})
		);
		const body = await filtered.json();
		expect(body.rows).toHaveLength(1);
		expect(body.rows[0].segmentId).toBe(Number(seg.id));
	});

	test('read share without details hides notes', async () => {
		const kit = getKit();
		const ownerRow = makeSyncedUser(kit, { email: 'owner@x.c', passwordHash: 'x', displayName: 'Owner' });
		const owner = validateOAuthUser(ownerRow.id)!;
		const viewerRow = makeSyncedUser(kit, { email: 'viewer@x.c', passwordHash: 'x', displayName: 'Viewer' });
		const viewer = validateOAuthUser(viewerRow.id)!;
		const t = makeSyncedTrip(kit, { ownerId: owner.id, name: 'T' });

		const marker = 'Booking ref SECRET-4455';
		const form = new FormData();
		form.set('file', fileFromString('qr', 'qr.png'));
		form.set('label', 'Shuttle QR');
		form.set('notes', marker);
		const create = await POST(
			event({ user: owner, params: { id: String(t.id) }, method: 'POST', form })
		);
		expect(create.status).toBe(201);

		createShare({ tripId: t.id, sharedWithUserId: viewer.id, permission: 'read', showDetails: false });

		const list = await GET(event({ user: viewer, params: { id: String(t.id) } }));
		const body = await list.json();
		expect(body.rows).toHaveLength(1);
		expect('notes' in body.rows[0]).toBe(true);
		expect(body.rows[0].notes).toBeNull();
		expect(body.rows[0].label).toBe('Shuttle QR');
		expect(body.rows[0].filename).toBe('qr.png');
		expect(JSON.stringify(body)).not.toContain(marker);

		const ownerList = await GET(event({ user: owner, params: { id: String(t.id) } }));
		const ownerBody = await ownerList.json();
		expect(ownerBody.rows[0].notes).toBe(marker);
	});

	test('edit share without details hides notes', async () => {
		const kit = getKit();
		const ownerRow = makeSyncedUser(kit, { email: 'owner@x.c', passwordHash: 'x', displayName: 'Owner' });
		const owner = validateOAuthUser(ownerRow.id)!;
		const editorRow = makeSyncedUser(kit, { email: 'editor@x.c', passwordHash: 'x', displayName: 'Editor' });
		const editor = validateOAuthUser(editorRow.id)!;
		const t = makeSyncedTrip(kit, { ownerId: owner.id, name: 'T' });

		const marker = 'Booking ref SECRET-4455';
		const form = new FormData();
		form.set('file', fileFromString('qr', 'qr.png'));
		form.set('notes', marker);
		await POST(event({ user: owner, params: { id: String(t.id) }, method: 'POST', form }));

		createShare({ tripId: t.id, sharedWithUserId: editor.id, permission: 'edit', showDetails: false });

		const list = await GET(event({ user: editor, params: { id: String(t.id) } }));
		const body = await list.json();
		expect(body.rows).toHaveLength(1);
		expect(body.rows[0].notes).toBeNull();
		expect(JSON.stringify(body)).not.toContain(marker);
	});

	test('share with details shows notes', async () => {
		const kit = getKit();
		const ownerRow = makeSyncedUser(kit, { email: 'owner@x.c', passwordHash: 'x', displayName: 'Owner' });
		const owner = validateOAuthUser(ownerRow.id)!;
		const viewerRow = makeSyncedUser(kit, { email: 'viewer@x.c', passwordHash: 'x', displayName: 'Viewer' });
		const viewer = validateOAuthUser(viewerRow.id)!;
		const t = makeSyncedTrip(kit, { ownerId: owner.id, name: 'T' });

		const marker = 'Booking ref SECRET-4455';
		const form = new FormData();
		form.set('file', fileFromString('qr', 'qr.png'));
		form.set('notes', marker);
		await POST(event({ user: owner, params: { id: String(t.id) }, method: 'POST', form }));

		createShare({ tripId: t.id, sharedWithUserId: viewer.id, permission: 'read', showDetails: true });

		const list = await GET(event({ user: viewer, params: { id: String(t.id) } }));
		const body = await list.json();
		expect(body.rows).toHaveLength(1);
		expect(body.rows[0].notes).toBe(marker);
	});

	test('segmentId filter path hides notes for viewers without details', async () => {
		const kit = getKit();
		const ownerRow = makeSyncedUser(kit, { email: 'owner@x.c', passwordHash: 'x', displayName: 'Owner' });
		const owner = validateOAuthUser(ownerRow.id)!;
		const viewerRow = makeSyncedUser(kit, { email: 'viewer@x.c', passwordHash: 'x', displayName: 'Viewer' });
		const viewer = validateOAuthUser(viewerRow.id)!;
		const t = makeSyncedTrip(kit, { ownerId: owner.id, name: 'T' });
		const seg = addSegment(owner.id, t.id, {
			type: 'shuttle',
			title: 'Airport transfer',
			localStart: '2026-09-01T10:00',
			startTz: 'Asia/Bangkok'
		});

		const marker = 'Booking ref SECRET-4455';
		const form = new FormData();
		form.set('file', fileFromString('voucher', 'v.pdf', 'application/pdf'));
		form.set('segmentId', String(seg.id));
		form.set('notes', marker);
		await POST(event({ user: owner, params: { id: String(t.id) }, method: 'POST', form }));

		createShare({ tripId: t.id, sharedWithUserId: viewer.id, permission: 'read', showDetails: false });

		const list = await GET(
			event({
				user: viewer,
				params: { id: String(t.id) },
				url: `http://localhost/api/mobile/trips/${t.id}/documents?segmentId=${seg.id}`
			})
		);
		const body = await list.json();
		expect(body.rows).toHaveLength(1);
		expect(body.rows[0].segmentId).toBe(Number(seg.id));
		expect(body.rows[0].notes).toBeNull();
		expect(JSON.stringify(body)).not.toContain(marker);
	});

	test('third user with no share gets 404', async () => {
		const kit = getKit();
		const ownerRow = makeSyncedUser(kit, { email: 'owner@x.c', passwordHash: 'x', displayName: 'Owner' });
		const owner = validateOAuthUser(ownerRow.id)!;
		const strangerRow = makeSyncedUser(kit, { email: 'stranger@x.c', passwordHash: 'x', displayName: 'Stranger' });
		const stranger = validateOAuthUser(strangerRow.id)!;
		const t = makeSyncedTrip(kit, { ownerId: owner.id, name: 'T' });

		await expect(
			async () => GET(event({ user: stranger, params: { id: String(t.id) } }))
		).rejects.toMatchObject({ status: 404 });
	});
});
