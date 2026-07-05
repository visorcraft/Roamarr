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
	const file = new File(['hello'], 'receipt.png', { type: 'image/png' });

	const { link, attachment } = await addAttachment(u.id, e.id, file);

	expect(attachment.filename).toBe('receipt.png');
	expect(attachment.contentType).toBe('image/png');
	expect(attachment.sizeBytes).toBe(5);
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
	const file = new File(['x'.repeat(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
	await expect(addAttachment(u.id, e.id, file)).rejects.toMatchObject({ status: 400 });
});

test('listAttachments returns rows ordered by creation time', async () => {
	const { u, e } = seed();
	const { link: a } = await addAttachment(u.id, e.id, new File(['a'], 'a.png', { type: 'image/png' }));
	const { link: b } = await addAttachment(u.id, e.id, new File(['b'], 'b.png', { type: 'image/png' }));

	const rows = listAttachments(e.id);
	expect(rows.map((r) => r.id)).toEqual([a.id, b.id]);
});

test('readAttachment decrypts the uploaded file', async () => {
	const { u, e } = seed();
	const file = new File(['secret receipt'], 'receipt.png', { type: 'image/png' });
	const { link } = await addAttachment(u.id, e.id, file);

	const { stream, record } = await readAttachment(u.id, link.id);
	const out = await streamToBuffer(stream);

	expect(record.filename).toBe('receipt.png');
	expect(out.toString('utf8')).toBe('secret receipt');
});

test('deleteAttachment removes the link and ciphertext', async () => {
	const { kit, u, e } = seed();
	const { link } = await addAttachment(u.id, e.id, new File(['c'], 'c.png', { type: 'image/png' }));

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
		addAttachment(other.id, e.id, new File(['x'], 'x.png', { type: 'image/png' }))
	).rejects.toMatchObject({ status: 404 });

	const { link } = await addAttachment(u.id, e.id, new File(['y'], 'y.png', { type: 'image/png' }));
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

	const file = new File(['read-only content'], 'receipt.png', { type: 'image/png' });
	const { link } = await addAttachment(u.id, e.id, file);

	const { stream } = await readAttachment(viewer.id, link.id);
	const out = await streamToBuffer(stream);
	expect(out.toString('utf8')).toBe('read-only content');
});
