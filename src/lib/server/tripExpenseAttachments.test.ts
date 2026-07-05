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

import { addAttachment, deleteAttachment, listAttachments, readAttachment } from './tripExpenseAttachments';
import { tripExpenseAttachments, tripExpenses, users, trips } from './db/mongrelSchema';
import { eq, type KitDatabase } from '@visorcraft/mongreldb-kit';
import { makeSyncedUser, makeSyncedTrip, makeShare, streamToBuffer } from '../../../tests/helpers';
import * as expensesRepo from './repositories/expensesRepo';

function fileFromString(s: string, name: string, type: 'image/png' | 'application/pdf' = 'image/png') {
	const prefixes: Record<string, Uint8Array> = {
		'image/png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		'application/pdf': new Uint8Array([0x25, 0x50, 0x44, 0x46])
	};
	const prefix = prefixes[type];
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
	baseDir = mkdtempSync(path.join(tmpdir(), 'roamarr-exp-att-'));
	process.env.ATTACHMENTS_PATH = baseDir;
	kit.deleteFrom(tripExpenseAttachments).executeSync();
	kit.deleteFrom(tripExpenses).executeSync();
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
	const u = makeSyncedUser(kit, { email: 'att@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const e = expensesRepo.createExpense({
		tripId: t.id,
		description: 'Dinner',
		amount: 5000,
		currency: 'USD'
	});
	return { kit, u, t, e };
}

test('addAttachment writes encrypted file and database rows', async () => {
	const { kit, u, e } = seed();
	const file = fileFromString('hello', 'receipt.png');

	const { link, attachment } = await addAttachment(u.id, e.id, file);

	expect(attachment.filename).toBe('receipt.png');
	expect(attachment.contentType).toBe('image/png');
	expect(attachment.sizeBytes).toBe(13); // 8-byte PNG magic + 'hello'
	expect(link.expenseId).toBe(e.id);
	expect(link.attachmentId).toBe(attachment.id);

	const rows = kit
		.selectFrom(tripExpenseAttachments)
		.where(eq(tripExpenseAttachments.expense_id, BigInt(e.id)))
		.executeSync();
	expect(rows).toHaveLength(1);
});

test('addAttachment rejects disallowed content types', async () => {
	const { u, e } = seed();
	const file = new File(['x'], 'malware.exe', { type: 'application/x-msdownload' });
	await expect(addAttachment(u.id, e.id, file)).rejects.toMatchObject({ status: 400 });
});

test('addAttachment rejects oversized files', async () => {
	const { u, e } = seed();
	const file = fileFromString('x'.repeat(10 * 1024 * 1024 + 1), 'big.png');
	await expect(addAttachment(u.id, e.id, file)).rejects.toMatchObject({ status: 400 });
});

test('listAttachments returns rows ordered by creation time', async () => {
	const { u, e } = seed();
	const { link: a } = await addAttachment(u.id, e.id, fileFromString('a', 'a.png'));
	const { link: b } = await addAttachment(u.id, e.id, fileFromString('b', 'b.png'));

	const rows = listAttachments(e.id);
	expect(rows.map((r) => r.id)).toEqual([a.id, b.id]);
});

test('readAttachment decrypts the uploaded file', async () => {
	const { u, e } = seed();
	const file = fileFromString('secret receipt', 'receipt.png');
	const { link } = await addAttachment(u.id, e.id, file);

	const { stream, record } = await readAttachment(u.id, link.id);
	const out = await streamToBuffer(stream);

	expect(record.filename).toBe('receipt.png');
	expect(out.toString('utf8')).toContain('secret receipt');
});

test('deleteAttachment removes the link and ciphertext', async () => {
	const { kit, u, e } = seed();
	const { link } = await addAttachment(u.id, e.id, fileFromString('c', 'c.png'));

	await deleteAttachment(u.id, link.id);

	expect(
		kit
			.selectFrom(tripExpenseAttachments)
			.where(eq(tripExpenseAttachments.id, BigInt(link.id)))
			.executeSync()[0]
	).toBeUndefined();
	await expect(readAttachment(u.id, link.id)).rejects.toMatchObject({ status: 404 });
});

test('non-editor cannot add or delete attachments', async () => {
	const { kit, u, e } = seed();
	const other = makeSyncedUser(kit, { email: 'other@x.c', passwordHash: 'x', displayName: 'O' });

	await expect(
		addAttachment(other.id, e.id, fileFromString('x', 'x.png'))
	).rejects.toMatchObject({ status: 404 });

	const { link } = await addAttachment(u.id, e.id, fileFromString('y', 'y.png'));
	await expect(deleteAttachment(other.id, link.id)).rejects.toMatchObject({ status: 404 });
});

test('read-only viewer can read attachment they did not upload', async () => {
	const { kit, u, t, e } = seed();
	const viewer = makeSyncedUser(kit, {
		email: 'viewer@x.c',
		passwordHash: 'x',
		displayName: 'V'
	});
	makeShare(kit, { tripId: t.id, sharedWithUserId: viewer.id, permission: 'read' });

	const file = fileFromString('read-only content', 'receipt.png');
	const { link } = await addAttachment(u.id, e.id, file);

	const { stream } = await readAttachment(viewer.id, link.id);
	const out = await streamToBuffer(stream);
	expect(out.toString('utf8')).toContain('read-only content');
});
