import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
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
import { tripExpenseAttachments } from './db/mongrelSchema';
import { tripExpenses as kitTripExpenses, users as kitUsers, trips as kitTrips } from './db/mongrelSchema';
import { eq } from '@mongreldb/kit';
import { makeSyncedUser, makeSyncedTrip } from '../../../tests/helpers';
import * as expensesRepo from './repositories/expensesRepo';

function attachmentsDir() {
	return path.resolve('./attachments');
}

beforeEach(() => {
	const sqlite = (ctx as { sqlite: any }).sqlite;
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	sqlite.exec(
		'delete from trip_expense_attachments; delete from trip_expenses; delete from trips; delete from users;'
	);
	kit.deleteFrom(kitTripExpenses).executeSync();
	kit.deleteFrom(kitTrips).executeSync();
	kit.deleteFrom(kitUsers).executeSync();
});

afterEach(() => {
	const dir = attachmentsDir();
	if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function seed() {
	const db = (ctx as { db: import('./db').DB }).db;
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	const u = makeSyncedUser(kit, { email: 'att@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const e = expensesRepo.createExpense({
		tripId: t.id,
		description: 'Dinner',
		amount: 5000,
		currency: 'USD'
	});
	return { db, kit, u, t, e };
}

test('addAttachment writes the file and database row', async () => {
	const { db, u, e } = seed();
	const file = new File(['hello'], 'receipt.png', { type: 'image/png' });

	const att = await addAttachment(u.id, e.id, file);

	expect(att.filename).toBe('receipt.png');
	expect(att.contentType).toBe('image/png');
	expect(att.sizeBytes).toBe(5);
	expect(att.expenseId).toBe(e.id);

	const rows = db.select().from(tripExpenseAttachments).where(eq(tripExpenseAttachments.expense_id, BigInt(e.id))).all();
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
	const { db, u, e } = seed();
	const att = await addAttachment(u.id, e.id, new File(['c'], 'c.png', { type: 'image/png' }));
	const withPath = getAttachmentWithPath(u.id, att.id);

	deleteAttachment(u.id, att.id);

	expect(db.select().from(tripExpenseAttachments).where(eq(tripExpenseAttachments.id, BigInt(att.id))).get()).toBeUndefined();
	expect(existsSync(withPath.path)).toBe(false);
});

test('non-editor cannot add or delete attachments', async () => {
	const { db, kit, u, e } = seed();
	const other = makeSyncedUser(kit, { email: 'other@x.c', passwordHash: 'x', displayName: 'O' });

	await expect(
		addAttachment(other.id, e.id, new File(['x'], 'x.png', { type: 'image/png' }))
	).rejects.toMatchObject({ status: 404 });

	const att = await addAttachment(u.id, e.id, new File(['y'], 'y.png', { type: 'image/png' }));
	expect(() => deleteAttachment(other.id, att.id)).toThrow();
});
