import { eq as kitEq, and as kitAnd, asc } from '@mongreldb/kit';
import { eq } from 'drizzle-orm';
import type { Row, Insert, Update } from '@mongreldb/kit';
import { db, kit } from '$lib/server/db';
import {
	tripExpenses,
	tripExpenseAttachments,
	tripBudgetCategories
} from '$lib/server/db/mongrelSchema';
import {
	tripExpenses as drizzleTripExpenses,
	tripExpenseAttachments as drizzleTripExpenseAttachments,
	tripBudgetCategories as drizzleTripBudgetCategories
} from '$lib/server/db/schema';

export type KitExpense = Row<typeof tripExpenses>;
export type KitAttachment = Row<typeof tripExpenseAttachments>;
export type KitBudgetCategory = Row<typeof tripBudgetCategories>;

export type ExpenseRow = typeof drizzleTripExpenses.$inferSelect;
export type AttachmentRow = typeof drizzleTripExpenseAttachments.$inferSelect;
export type BudgetCategoryRow = typeof drizzleTripBudgetCategories.$inferSelect;

export type CreateExpenseInput = Pick<ExpenseRow, 'tripId' | 'description' | 'amount' | 'currency'> &
	Partial<Pick<ExpenseRow, 'category' | 'exchangeRate' | 'baseAmount'>> & {
		paidByCompanionId?: number | null;
		splitAmong?: string;
	};

export type UpdateExpenseInput = Partial<
	Omit<CreateExpenseInput, 'tripId'> & { splitAmong?: string }
>;

export type CreateAttachmentInput = Pick<
	AttachmentRow,
	'expenseId' | 'filename' | 'storageKey' | 'contentType' | 'sizeBytes'
>;

export type CreateBudgetCategoryInput = Pick<BudgetCategoryRow, 'tripId' | 'category' | 'amount'> &
	Partial<Pick<BudgetCategoryRow, 'currency'>>;

export type UpdateBudgetCategoryInput = Partial<Pick<BudgetCategoryRow, 'amount' | 'currency'>>;

function toBigInt(id: number): bigint {
	return BigInt(id);
}

function num(id: bigint): number {
	return Number(id);
}

function nullableIntToNumber(id: bigint | null | undefined): number | null {
	if (id == null || id === 0n) return null;
	return Number(id);
}

function serializeSplitAmong(value: unknown): string {
	if (value == null) return '[]';
	if (typeof value === 'string') return value;
	return JSON.stringify(value);
}

export function toExpenseRow(row: KitExpense): ExpenseRow {
	return {
		id: num(row.id),
		tripId: num(row.trip_id),
		description: row.description,
		amount: Number(row.amount),
		currency: row.currency,
		category: row.category,
		exchangeRate: Number(row.exchange_rate),
		baseAmount: Number(row.base_amount),
		paidByCompanionId: nullableIntToNumber(row.paid_by_companion_id),
		splitAmong: serializeSplitAmong(row.split_among),
		createdAt: row.created_at
	};
}

export function toAttachmentRow(row: KitAttachment): AttachmentRow {
	return {
		id: num(row.id),
		expenseId: num(row.expense_id),
		filename: row.filename,
		storageKey: row.storage_key,
		contentType: row.content_type,
		sizeBytes: Number(row.size_bytes),
		createdAt: row.created_at
	};
}

export function toBudgetCategoryRow(row: KitBudgetCategory): BudgetCategoryRow {
	return {
		id: num(row.id),
		tripId: num(row.trip_id),
		category: row.category,
		amount: Number(row.amount),
		currency: row.currency,
		createdAt: row.created_at
	};
}

function kitExpenseToDrizzleInsert(row: KitExpense) {
	return {
		id: num(row.id),
		tripId: num(row.trip_id),
		description: row.description,
		amount: Number(row.amount),
		currency: row.currency,
		category: row.category,
		exchangeRate: Number(row.exchange_rate),
		baseAmount: Number(row.base_amount),
		paidByCompanionId: nullableIntToNumber(row.paid_by_companion_id),
		splitAmong: serializeSplitAmong(row.split_among),
		createdAt: row.created_at
	};
}

function kitAttachmentToDrizzleInsert(row: KitAttachment) {
	return {
		id: num(row.id),
		expenseId: num(row.expense_id),
		filename: row.filename,
		storageKey: row.storage_key,
		contentType: row.content_type,
		sizeBytes: Number(row.size_bytes),
		createdAt: row.created_at
	};
}

function kitBudgetCategoryToDrizzleInsert(row: KitBudgetCategory) {
	return {
		id: num(row.id),
		tripId: num(row.trip_id),
		category: row.category,
		amount: Number(row.amount),
		currency: row.currency,
		createdAt: row.created_at
	};
}

function syncExpenseToLegacy(row: KitExpense) {
	const values = kitExpenseToDrizzleInsert(row);
	const existing = db
		.select()
		.from(drizzleTripExpenses)
		.where(eq(drizzleTripExpenses.id, values.id))
		.get();
	if (existing) {
		db.update(drizzleTripExpenses)
			.set(values)
			.where(eq(drizzleTripExpenses.id, values.id))
			.run();
	} else {
		db.insert(drizzleTripExpenses).values(values).run();
	}
}

function syncAttachmentToLegacy(row: KitAttachment) {
	const values = kitAttachmentToDrizzleInsert(row);
	const existing = db
		.select()
		.from(drizzleTripExpenseAttachments)
		.where(eq(drizzleTripExpenseAttachments.id, values.id))
		.get();
	if (existing) {
		db.update(drizzleTripExpenseAttachments)
			.set(values)
			.where(eq(drizzleTripExpenseAttachments.id, values.id))
			.run();
	} else {
		db.insert(drizzleTripExpenseAttachments).values(values).run();
	}
}

function syncBudgetCategoryToLegacy(row: KitBudgetCategory) {
	const values = kitBudgetCategoryToDrizzleInsert(row);
	const existing = db
		.select()
		.from(drizzleTripBudgetCategories)
		.where(eq(drizzleTripBudgetCategories.id, values.id))
		.get();
	if (existing) {
		db.update(drizzleTripBudgetCategories)
			.set(values)
			.where(eq(drizzleTripBudgetCategories.id, values.id))
			.run();
	} else {
		db.insert(drizzleTripBudgetCategories).values(values).run();
	}
}

function deleteExpenseFromLegacy(id: number) {
	db.delete(drizzleTripExpenses).where(eq(drizzleTripExpenses.id, id)).run();
}

function deleteAttachmentFromLegacy(id: number) {
	db.delete(drizzleTripExpenseAttachments).where(eq(drizzleTripExpenseAttachments.id, id)).run();
}

function deleteBudgetCategoryFromLegacy(id: number) {
	db.delete(drizzleTripBudgetCategories).where(eq(drizzleTripBudgetCategories.id, id)).run();
}

// Expenses

export function listExpensesForTrip(tripId: number): ExpenseRow[] {
	return kit
		.selectFrom(tripExpenses)
		.where(kitEq(tripExpenses.trip_id, toBigInt(tripId)))
		.orderBy(asc(tripExpenses.created_at))
		.executeSync()
		.map(toExpenseRow);
}

export function getExpenseById(id: number): ExpenseRow | null {
	const rows = kit.selectFrom(tripExpenses).where(kitEq(tripExpenses.id, toBigInt(id))).executeSync();
	return rows[0] ? toExpenseRow(rows[0]) : null;
}

export function createExpense(input: CreateExpenseInput): ExpenseRow {
	const row = kit
		.insertInto(tripExpenses)
		.values({
			trip_id: toBigInt(input.tripId),
			description: input.description,
			amount: BigInt(input.amount),
			currency: input.currency,
			category: input.category,
			exchange_rate: BigInt(input.exchangeRate ?? 10000),
			base_amount: BigInt(input.baseAmount ?? 0),
			paid_by_companion_id: input.paidByCompanionId ? toBigInt(input.paidByCompanionId) : null,
			split_among: input.splitAmong == null ? '[]' : input.splitAmong
		} as Insert<typeof tripExpenses>)
		.executeSync();
	syncExpenseToLegacy(row);
	return toExpenseRow(row);
}

export function updateExpense(id: number, patch: UpdateExpenseInput): ExpenseRow | null {
	const existing = kit
		.selectFrom(tripExpenses)
		.where(kitEq(tripExpenses.id, toBigInt(id)))
		.executeSync()[0];
	if (!existing) return null;

	const { id: _existingId, ...existingRest } = existing;
	const merged: Update<typeof tripExpenses> = { ...existingRest };
	if (patch.description !== undefined) merged.description = patch.description;
	if (patch.amount !== undefined) merged.amount = BigInt(patch.amount);
	if (patch.currency !== undefined) merged.currency = patch.currency;
	if (patch.category !== undefined) merged.category = patch.category;
	if (patch.exchangeRate !== undefined) merged.exchange_rate = BigInt(patch.exchangeRate);
	if (patch.baseAmount !== undefined) merged.base_amount = BigInt(patch.baseAmount);
	if (patch.paidByCompanionId !== undefined) {
		merged.paid_by_companion_id = patch.paidByCompanionId ? toBigInt(patch.paidByCompanionId) : null;
	}
	if (patch.splitAmong !== undefined) {
		merged.split_among = patch.splitAmong == null ? '[]' : patch.splitAmong;
	}
	if (merged.paid_by_companion_id === 0n) {
		merged.paid_by_companion_id = null;
	}

	const updated = kit
		.updateTable(tripExpenses)
		.set(merged)
		.where(kitEq(tripExpenses.id, toBigInt(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	syncExpenseToLegacy(row);
	return toExpenseRow(row);
}

export function deleteExpense(id: number): boolean {
	const deleted = kit.deleteFrom(tripExpenses).where(kitEq(tripExpenses.id, toBigInt(id))).executeSync();
	deleteExpenseFromLegacy(id);
	return deleted > 0n;
}

export function deleteExpensesForTrip(tripId: number): bigint {
	const ids = kit
		.selectFrom(tripExpenses)
		.where(kitEq(tripExpenses.trip_id, toBigInt(tripId)))
		.executeSync()
		.map((r) => num(r.id));
	const deleted = kit
		.deleteFrom(tripExpenses)
		.where(kitEq(tripExpenses.trip_id, toBigInt(tripId)))
		.executeSync();
	for (const id of ids) {
		deleteExpenseFromLegacy(id);
	}
	return deleted;
}

// Attachments

export function listAttachmentsForExpense(expenseId: number): AttachmentRow[] {
	return kit
		.selectFrom(tripExpenseAttachments)
		.where(kitEq(tripExpenseAttachments.expense_id, toBigInt(expenseId)))
		.orderBy(asc(tripExpenseAttachments.created_at))
		.executeSync()
		.map(toAttachmentRow);
}

export function getAttachmentById(id: number): AttachmentRow | null {
	const rows = kit
		.selectFrom(tripExpenseAttachments)
		.where(kitEq(tripExpenseAttachments.id, toBigInt(id)))
		.executeSync();
	return rows[0] ? toAttachmentRow(rows[0]) : null;
}

export function getAttachmentByStorageKey(storageKey: string): AttachmentRow | null {
	const rows = kit
		.selectFrom(tripExpenseAttachments)
		.where(kitEq(tripExpenseAttachments.storage_key, storageKey))
		.executeSync();
	return rows[0] ? toAttachmentRow(rows[0]) : null;
}

export function createAttachment(input: CreateAttachmentInput): AttachmentRow {
	const row = kit
		.insertInto(tripExpenseAttachments)
		.values({
			expense_id: toBigInt(input.expenseId),
			filename: input.filename,
			storage_key: input.storageKey,
			content_type: input.contentType,
			size_bytes: BigInt(input.sizeBytes)
		} as Insert<typeof tripExpenseAttachments>)
		.executeSync();
	syncAttachmentToLegacy(row);
	return toAttachmentRow(row);
}

export function deleteAttachment(id: number): boolean {
	const deleted = kit
		.deleteFrom(tripExpenseAttachments)
		.where(kitEq(tripExpenseAttachments.id, toBigInt(id)))
		.executeSync();
	deleteAttachmentFromLegacy(id);
	return deleted > 0n;
}

export function deleteAttachmentsForExpense(expenseId: number): bigint {
	const ids = kit
		.selectFrom(tripExpenseAttachments)
		.where(kitEq(tripExpenseAttachments.expense_id, toBigInt(expenseId)))
		.executeSync()
		.map((r) => num(r.id));
	const deleted = kit
		.deleteFrom(tripExpenseAttachments)
		.where(kitEq(tripExpenseAttachments.expense_id, toBigInt(expenseId)))
		.executeSync();
	for (const id of ids) {
		deleteAttachmentFromLegacy(id);
	}
	return deleted;
}

// Budget categories

export function listBudgetCategoriesForTrip(tripId: number): BudgetCategoryRow[] {
	return kit
		.selectFrom(tripBudgetCategories)
		.where(kitEq(tripBudgetCategories.trip_id, toBigInt(tripId)))
		.executeSync()
		.map(toBudgetCategoryRow);
}

export function getBudgetCategoryById(id: number): BudgetCategoryRow | null {
	const rows = kit
		.selectFrom(tripBudgetCategories)
		.where(kitEq(tripBudgetCategories.id, toBigInt(id)))
		.executeSync();
	return rows[0] ? toBudgetCategoryRow(rows[0]) : null;
}

export function getBudgetCategoryByTripAndCategory(
	tripId: number,
	category: string
): BudgetCategoryRow | null {
	const rows = kit
		.selectFrom(tripBudgetCategories)
		.where(
			kitAnd(
				kitEq(tripBudgetCategories.trip_id, toBigInt(tripId)),
				kitEq(tripBudgetCategories.category, category)
			)
		)
		.executeSync();
	return rows[0] ? toBudgetCategoryRow(rows[0]) : null;
}

export function createBudgetCategory(input: CreateBudgetCategoryInput): BudgetCategoryRow {
	const row = kit
		.insertInto(tripBudgetCategories)
		.values({
			trip_id: toBigInt(input.tripId),
			category: input.category,
			amount: BigInt(input.amount),
			currency: input.currency ?? 'USD'
		} as Insert<typeof tripBudgetCategories>)
		.executeSync();
	syncBudgetCategoryToLegacy(row);
	return toBudgetCategoryRow(row);
}

export function updateBudgetCategory(
	id: number,
	patch: UpdateBudgetCategoryInput
): BudgetCategoryRow | null {
	const existing = kit
		.selectFrom(tripBudgetCategories)
		.where(kitEq(tripBudgetCategories.id, toBigInt(id)))
		.executeSync()[0];
	if (!existing) return null;

	const { id: _existingId, ...existingRest } = existing;
	const merged: Update<typeof tripBudgetCategories> = { ...existingRest };
	if (patch.amount !== undefined) merged.amount = BigInt(patch.amount);
	if (patch.currency !== undefined) merged.currency = patch.currency;

	const updated = kit
		.updateTable(tripBudgetCategories)
		.set(merged)
		.where(kitEq(tripBudgetCategories.id, toBigInt(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	syncBudgetCategoryToLegacy(row);
	return toBudgetCategoryRow(row);
}

export function deleteBudgetCategory(id: number): boolean {
	const deleted = kit
		.deleteFrom(tripBudgetCategories)
		.where(kitEq(tripBudgetCategories.id, toBigInt(id)))
		.executeSync();
	deleteBudgetCategoryFromLegacy(id);
	return deleted > 0n;
}

export function deleteBudgetCategoriesForTrip(tripId: number): bigint {
	const ids = kit
		.selectFrom(tripBudgetCategories)
		.where(kitEq(tripBudgetCategories.trip_id, toBigInt(tripId)))
		.executeSync()
		.map((r) => num(r.id));
	const deleted = kit
		.deleteFrom(tripBudgetCategories)
		.where(kitEq(tripBudgetCategories.trip_id, toBigInt(tripId)))
		.executeSync();
	for (const id of ids) {
		deleteBudgetCategoryFromLegacy(id);
	}
	return deleted;
}
