import { test, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { eq, type KitDatabase } from '@visorcraft/mongreldb-kit';
import * as expensesRepo from './expensesRepo';
import * as usersRepo from './usersRepo';
import * as tripsRepo from './tripsRepo';
import {
	users,
	trips,
	tripExpenses,
	attachments,
	tripExpenseAttachments,
	tripBudgetCategories
} from '$lib/server/db/mongrelSchema';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function makeUser(email: string) {
	return usersRepo.createUser({
		email,
		password_hash: 'x',
		display_name: email,
		calendar_token: null,
		calendar_token_expires_at: null
	});
}

function makeTrip(ownerId: number, name: string) {
	return tripsRepo.createTrip(ownerId, { name, calendarToken: randomUUID() });
}

beforeEach(() => {
	const kit = kitDb();
	kit.deleteFrom(tripExpenseAttachments).executeSync();
	kit.deleteFrom(tripExpenses).executeSync();
	kit.deleteFrom(tripBudgetCategories).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('create/list/get/update/delete expense', () => {
	const kit = kitDb();
	const u = makeUser('expense@x.c');
	const t = makeTrip(Number(u.id), 'Expenses Trip');

	const created = expensesRepo.createExpense({
		tripId: t.id,
		description: 'Lunch',
		amount: 1500,
		currency: 'USD',
		category: 'food',
		exchangeRate: 10000,
		baseAmount: 1500,
		paidByCompanionId: null,
		splitAmong: JSON.stringify([])
	});
	expect(created.description).toBe('Lunch');
	expect(created.amount).toBe(1500);
	expect(created.splitAmong).toBe('[]');

	expect(expensesRepo.listExpensesForTrip(t.id)).toHaveLength(1);
	expect(expensesRepo.getExpenseById(created.id)?.description).toBe('Lunch');

	const stored = kit
		.selectFrom(tripExpenses)
		.where(eq(tripExpenses.id, BigInt(created.id)))
		.executeSync()[0];
	expect(stored?.description).toBe('Lunch');

	const updated = expensesRepo.updateExpense(created.id, {
		description: 'Dinner',
		amount: 2500,
		currency: 'EUR',
		category: 'food',
		exchangeRate: 11000,
		baseAmount: 2750,
		splitAmong: JSON.stringify(['owner'])
	});
	expect(updated?.description).toBe('Dinner');
	expect(updated?.amount).toBe(2500);
	expect(updated?.splitAmong).toBe(JSON.stringify(['owner']));

	const storedUpdated = kit
		.selectFrom(tripExpenses)
		.where(eq(tripExpenses.id, BigInt(created.id)))
		.executeSync()[0];
	expect(storedUpdated?.description).toBe('Dinner');

	expect(expensesRepo.deleteExpense(created.id)).toBe(true);
	expect(expensesRepo.getExpenseById(created.id)).toBeNull();
	expect(expensesRepo.listExpensesForTrip(t.id)).toHaveLength(0);
	expect(
		kit.selectFrom(tripExpenses).where(eq(tripExpenses.id, BigInt(created.id))).executeSync()[0]
	).toBeUndefined();
});

test('attachment CRUD', () => {
	const kit = kitDb();
	const u = makeUser('attach@x.c');
	const t = makeTrip(Number(u.id), 'Attachment Trip');
	const e = expensesRepo.createExpense({
		tripId: t.id,
		description: 'Taxi',
		amount: 1200,
		currency: 'USD',
		category: 'transport',
		exchangeRate: 10000,
		baseAmount: 1200
	});

	const att = kit.insertInto(attachments).values({
		owner_id: u.id,
		storage_key: 'abc-123',
		filename: 'receipt.pdf',
		content_type: 'application/pdf',
		size_bytes: BigInt(2048),
		context: '{}'
	}).executeSync();

	const link = expensesRepo.createExpenseAttachmentLink(e.id, Number(att.id));
	expect(link.expenseId).toBe(e.id);
	expect(link.attachmentId).toBe(Number(att.id));

	const rows = expensesRepo.listAttachmentsForExpense(e.id);
	expect(rows).toHaveLength(1);
	expect(rows[0].id).toBe(link.id);
	expect(rows[0].attachmentId).toBe(Number(att.id));
	expect(rows[0].filename).toBe('receipt.pdf');
	expect(rows[0].contentType).toBe('application/pdf');
	expect(rows[0].sizeBytes).toBe(2048);

	expect(expensesRepo.getExpenseAttachmentLinkById(link.id)?.attachmentId).toBe(Number(att.id));

	const stored = kit
		.selectFrom(attachments)
		.where(eq(attachments.id, att.id))
		.executeSync()[0];
	expect(stored?.filename).toBe('receipt.pdf');

	expect(expensesRepo.deleteExpenseAttachmentLink(link.id)).toBe(true);
	expect(expensesRepo.getExpenseAttachmentLinkById(link.id)).toBeNull();
	expect(expensesRepo.listAttachmentsForExpense(e.id)).toHaveLength(0);
	expect(
		kit
			.selectFrom(tripExpenseAttachments)
			.where(eq(tripExpenseAttachments.id, BigInt(link.id)))
			.executeSync()[0]
	).toBeUndefined();
});

test('listAttachmentsForExpenses batches attachments for multiple expenses', () => {
	const kit = kitDb();
	const u = makeUser('batch@x.c');
	const t = makeTrip(Number(u.id), 'Batch Trip');
	const e1 = expensesRepo.createExpense({
		tripId: t.id,
		description: 'E1',
		amount: 100,
		currency: 'USD',
		exchangeRate: 10000,
		baseAmount: 100
	});
	const e2 = expensesRepo.createExpense({
		tripId: t.id,
		description: 'E2',
		amount: 200,
		currency: 'USD',
		exchangeRate: 10000,
		baseAmount: 200
	});

	const att1 = kit.insertInto(attachments).values({
		owner_id: u.id,
		storage_key: 'batch-1',
		filename: 'r1.pdf',
		content_type: 'application/pdf',
		size_bytes: BigInt(1024),
		context: '{}'
	}).executeSync();
	const att2 = kit.insertInto(attachments).values({
		owner_id: u.id,
		storage_key: 'batch-2',
		filename: 'r2.pdf',
		content_type: 'application/pdf',
		size_bytes: BigInt(2048),
		context: '{}'
	}).executeSync();

	expensesRepo.createExpenseAttachmentLink(e1.id, Number(att1.id));
	expensesRepo.createExpenseAttachmentLink(e2.id, Number(att2.id));

	const map = expensesRepo.listAttachmentsForExpenses([e1.id, e2.id, 99999]);
	expect(map.get(e1.id)).toHaveLength(1);
	expect(map.get(e1.id)![0].filename).toBe('r1.pdf');
	expect(map.get(e2.id)).toHaveLength(1);
	expect(map.get(e2.id)![0].filename).toBe('r2.pdf');
	expect(map.get(99999)).toHaveLength(0);
});

test('budget category CRUD', () => {
	const kit = kitDb();
	const u = makeUser('budget@x.c');
	const t = makeTrip(Number(u.id), 'Budget Trip');

	const cat = expensesRepo.createBudgetCategory({
		tripId: t.id,
		category: 'food',
		amount: 10000,
		currency: 'USD'
	});
	expect(cat.category).toBe('food');
	expect(cat.amount).toBe(10000);

	expect(expensesRepo.listBudgetCategoriesForTrip(t.id)).toHaveLength(1);
	expect(expensesRepo.getBudgetCategoryById(cat.id)?.category).toBe('food');
	expect(expensesRepo.getBudgetCategoryByTripAndCategory(t.id, 'food')?.id).toBe(cat.id);

	const stored = kit
		.selectFrom(tripBudgetCategories)
		.where(eq(tripBudgetCategories.id, BigInt(cat.id)))
		.executeSync()[0];
	expect(Number(stored?.amount)).toBe(10000);

	const updated = expensesRepo.updateBudgetCategory(cat.id, { amount: 20000, currency: 'EUR' });
	expect(updated?.amount).toBe(20000);
	expect(updated?.currency).toBe('EUR');

	const storedUpdated = kit
		.selectFrom(tripBudgetCategories)
		.where(eq(tripBudgetCategories.id, BigInt(cat.id)))
		.executeSync()[0];
	expect(Number(storedUpdated?.amount)).toBe(20000);

	expect(expensesRepo.deleteBudgetCategory(cat.id)).toBe(true);
	expect(expensesRepo.getBudgetCategoryById(cat.id)).toBeNull();
	expect(expensesRepo.listBudgetCategoriesForTrip(t.id)).toHaveLength(0);
	expect(
		kit
			.selectFrom(tripBudgetCategories)
			.where(eq(tripBudgetCategories.id, BigInt(cat.id)))
			.executeSync()[0]
	).toBeUndefined();
});

test('cascade delete removes expenses, attachments, and budget categories with trip', () => {
	const kit = kitDb();
	const u = makeUser('cascade@x.c');
	const t = makeTrip(Number(u.id), 'Cascade Trip');

	const e = expensesRepo.createExpense({
		tripId: t.id,
		description: 'Hotel',
		amount: 50000,
		currency: 'USD',
		category: 'lodging',
		exchangeRate: 10000,
		baseAmount: 50000
	});
	const att = kit.insertInto(attachments).values({
		owner_id: u.id,
		storage_key: 'cascade-key',
		filename: 'invoice.pdf',
		content_type: 'application/pdf',
		size_bytes: BigInt(4096),
		context: '{}'
	}).executeSync();
	const link = expensesRepo.createExpenseAttachmentLink(e.id, Number(att.id));
	const cat = expensesRepo.createBudgetCategory({
		tripId: t.id,
		category: 'lodging',
		amount: 60000,
		currency: 'USD'
	});

	tripsRepo.deleteTrip(t.id);

	expect(expensesRepo.listExpensesForTrip(t.id)).toHaveLength(0);
	expect(expensesRepo.getExpenseById(e.id)).toBeNull();
	expect(expensesRepo.listAttachmentsForExpense(e.id)).toHaveLength(0);
	expect(expensesRepo.getExpenseAttachmentLinkById(link.id)).toBeNull();
	expect(expensesRepo.listBudgetCategoriesForTrip(t.id)).toHaveLength(0);
	expect(expensesRepo.getBudgetCategoryById(cat.id)).toBeNull();

	expect(
		kit.selectFrom(tripExpenses).where(eq(tripExpenses.id, BigInt(e.id))).executeSync()[0]
	).toBeUndefined();
	expect(
		kit
			.selectFrom(tripExpenseAttachments)
			.where(eq(tripExpenseAttachments.id, BigInt(link.id)))
			.executeSync()[0]
	).toBeUndefined();
	expect(
		kit
			.selectFrom(tripBudgetCategories)
			.where(eq(tripBudgetCategories.id, BigInt(cat.id)))
			.executeSync()[0]
	).toBeUndefined();
});
