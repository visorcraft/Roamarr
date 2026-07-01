import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	addAttachment,
	deleteAttachment,
	getAttachmentWithPath,
	listAttachments
} from './tripExpenseAttachments';
import { tripExpenseAttachments, tripExpenses, users, trips } from './db/mongrelSchema';
import { eq, type KitDatabase } from '@visorcraft/mongreldb-kit';
import { makeSyncedUser, makeSyncedTrip } from '../../../tests/helpers';
import * as expensesRepo from './repositories/expensesRepo';

function getKit(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function attachmentsDir() {
	return path.resolve('./attachments');
}

beforeEach(() => {
	const kit = getKit();
	kit.deleteFrom(tripExpenseAttachments).executeSync();
	kit.deleteFrom(tripExpenses).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
});

afterEach(() => {
	const dir = attachmentsDir();
	if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
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

test('addAttachment writes the file and database row', async () => {
	const { kit, u, e } = seed();
	const file = new File(['hello'], 'receipt.png', { type: 'image/png' });

	const att = await addAttachment(u.id, e.id, file);

	expect(att.filename).toBe('receipt.png');
	expect(att.contentType).toBe('image/png');
	expect(att.sizeBytes).toBe(5);
	expect(att.expenseId).toBe(e.id);

	const rows = kit
		.selectFrom(tripExpenseAttachments)
		.where(eq(tripExpenseAttachments.expense_id, BigInt(e.id)))
		.executeSync();
	expect(rows).toHaveLength(1);

	const withPath = getAttachmentWithPath(u.id, att.id);
	expect(existsSync(withPath.path)).toBe(true);
});

test('addAttachment rejects disallowed content types', async () => {
	const { u, e } = seed();
	const file = new File(['x'], 'malware.exe', { type: 'application/x-msdownload' });
	await expect(addAttachment(u.id, e.id, file)).rejects.toMatchObject({ status: 400 });
});

test('addAttachment rejects oversized files', async () => {
	const { u, e } = seed();
	const file = new File(['x'.repeat(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
	await expect(addAttachment(u.id, e.id, file)).rejects.toMatchObject({ status: 400 });
});

test('listAttachments returns rows ordered by creation time', async () => {
	const { u, e } = seed();
	const a = await addAttachment(u.id, e.id, new File(['a'], 'a.png', { type: 'image/png' }));
	const b = await addAttachment(u.id, e.id, new File(['b'], 'b.png', { type: 'image/png' }));

	const rows = listAttachments(e.id);
	expect(rows.map((r) => r.id)).toEqual([a.id, b.id]);
});

test('deleteAttachment removes the row and file', async () => {
	const { kit, u, e } = seed();
	const att = await addAttachment(u.id, e.id, new File(['c'], 'c.png', { type: 'image/png' }));
	const withPath = getAttachmentWithPath(u.id, att.id);

	deleteAttachment(u.id, att.id);

	expect(
		kit
			.selectFrom(tripExpenseAttachments)
			.where(eq(tripExpenseAttachments.id, BigInt(att.id)))
			.executeSync()[0]
	).toBeUndefined();
	expect(existsSync(withPath.path)).toBe(false);
});

test('non-editor cannot add or delete attachments', async () => {
	const { kit, u, e } = seed();
	const other = makeSyncedUser(kit, { email: 'other@x.c', passwordHash: 'x', displayName: 'O' });

	await expect(
		addAttachment(other.id, e.id, new File(['x'], 'x.png', { type: 'image/png' }))
	).rejects.toMatchObject({ status: 404 });

	const att = await addAttachment(u.id, e.id, new File(['y'], 'y.png', { type: 'image/png' }));
	expect(() => deleteAttachment(other.id, att.id)).toThrow();
});
