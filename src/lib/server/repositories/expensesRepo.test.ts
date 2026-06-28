import { test, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { eq } from 'drizzle-orm';
import * as expensesRepo from './expensesRepo';
import * as usersRepo from './usersRepo';
import * as tripsRepo from './tripsRepo';
import {
	users as drizzleUsers,
	trips as drizzleTrips,
	tripExpenses as drizzleTripExpenses,
	tripExpenseAttachments as drizzleTripExpenseAttachments,
	tripBudgetCategories as drizzleTripBudgetCategories
} from '$lib/server/db/schema';
import {
	users as kitUsers,
	trips as kitTrips,
	tripExpenses as kitTripExpenses,
	tripExpenseAttachments as kitTripExpenseAttachments,
	tripBudgetCategories as kitTripBudgetCategories
} from '$lib/server/db/mongrelSchema';

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
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	const db = (ctx as { db: import('$lib/server/db').DB }).db;

	kit.deleteFrom(kitTripExpenseAttachments).executeSync();
	kit.deleteFrom(kitTripExpenses).executeSync();
	kit.deleteFrom(kitTripBudgetCategories).executeSync();
	kit.deleteFrom(kitTrips).executeSync();
	kit.deleteFrom(kitUsers).executeSync();

	db.delete(drizzleTripExpenseAttachments).run();
	db.delete(drizzleTripExpenses).run();
	db.delete(drizzleTripBudgetCategories).run();
	db.delete(drizzleTrips).run();
	db.delete(drizzleUsers).run();
});

test('create/list/get/update/delete expense', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
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

	const legacy = db
		.select()
		.from(drizzleTripExpenses)
		.where(eq(drizzleTripExpenses.id, created.id))
		.get();
	expect(legacy?.description).toBe('Lunch');

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

	const legacyUpdated = db
		.select()
		.from(drizzleTripExpenses)
		.where(eq(drizzleTripExpenses.id, created.id))
		.get();
	expect(legacyUpdated?.description).toBe('Dinner');

	expect(expensesRepo.deleteExpense(created.id)).toBe(true);
	expect(expensesRepo.getExpenseById(created.id)).toBeNull();
	expect(expensesRepo.listExpensesForTrip(t.id)).toHaveLength(0);
	expect(
		db.select().from(drizzleTripExpenses).where(eq(drizzleTripExpenses.id, created.id)).get()
	).toBeUndefined();
});

test('attachment CRUD', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
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

	const att = expensesRepo.createAttachment({
		expenseId: e.id,
		filename: 'receipt.pdf',
		storageKey: 'abc-123',
		contentType: 'application/pdf',
		sizeBytes: 2048
	});
	expect(att.filename).toBe('receipt.pdf');
	expect(att.expenseId).toBe(e.id);

	expect(expensesRepo.listAttachmentsForExpense(e.id)).toHaveLength(1);
	expect(expensesRepo.getAttachmentById(att.id)?.storageKey).toBe('abc-123');
	expect(expensesRepo.getAttachmentByStorageKey('abc-123')?.id).toBe(att.id);

	const legacy = db
		.select()
		.from(drizzleTripExpenseAttachments)
		.where(eq(drizzleTripExpenseAttachments.id, att.id))
		.get();
	expect(legacy?.filename).toBe('receipt.pdf');

	expect(expensesRepo.deleteAttachment(att.id)).toBe(true);
	expect(expensesRepo.getAttachmentById(att.id)).toBeNull();
	expect(expensesRepo.listAttachmentsForExpense(e.id)).toHaveLength(0);
	expect(
		db
			.select()
			.from(drizzleTripExpenseAttachments)
			.where(eq(drizzleTripExpenseAttachments.id, att.id))
			.get()
	).toBeUndefined();
});

test('budget category CRUD', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
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

	const legacy = db
		.select()
		.from(drizzleTripBudgetCategories)
		.where(eq(drizzleTripBudgetCategories.id, cat.id))
		.get();
	expect(legacy?.amount).toBe(10000);

	const updated = expensesRepo.updateBudgetCategory(cat.id, { amount: 20000, currency: 'EUR' });
	expect(updated?.amount).toBe(20000);
	expect(updated?.currency).toBe('EUR');

	const legacyUpdated = db
		.select()
		.from(drizzleTripBudgetCategories)
		.where(eq(drizzleTripBudgetCategories.id, cat.id))
		.get();
	expect(legacyUpdated?.amount).toBe(20000);

	expect(expensesRepo.deleteBudgetCategory(cat.id)).toBe(true);
	expect(expensesRepo.getBudgetCategoryById(cat.id)).toBeNull();
	expect(expensesRepo.listBudgetCategoriesForTrip(t.id)).toHaveLength(0);
	expect(
		db
			.select()
			.from(drizzleTripBudgetCategories)
			.where(eq(drizzleTripBudgetCategories.id, cat.id))
			.get()
	).toBeUndefined();
});

test('cascade delete removes expenses, attachments, and budget categories with trip', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
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
	const att = expensesRepo.createAttachment({
		expenseId: e.id,
		filename: 'invoice.pdf',
		storageKey: 'cascade-key',
		contentType: 'application/pdf',
		sizeBytes: 4096
	});
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
	expect(expensesRepo.getAttachmentById(att.id)).toBeNull();
	expect(expensesRepo.listBudgetCategoriesForTrip(t.id)).toHaveLength(0);
	expect(expensesRepo.getBudgetCategoryById(cat.id)).toBeNull();

	expect(
		db.select().from(drizzleTripExpenses).where(eq(drizzleTripExpenses.id, e.id)).get()
	).toBeUndefined();
	expect(
		db
			.select()
			.from(drizzleTripExpenseAttachments)
			.where(eq(drizzleTripExpenseAttachments.id, att.id))
			.get()
	).toBeUndefined();
	expect(
		db
			.select()
			.from(drizzleTripBudgetCategories)
			.where(eq(drizzleTripBudgetCategories.id, cat.id))
			.get()
	).toBeUndefined();
});
