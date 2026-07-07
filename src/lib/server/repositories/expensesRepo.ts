import { eq as kitEq, and as kitAnd, asc, joinEq, inList as kitInList } from '@visorcraft/mongreldb-kit';
import type { Row, Insert, Update } from '@visorcraft/mongreldb-kit';
import {
	runSyncTxn,
	toCells,
	enforceForeignKeys,
	stageUniqueGuards,
	stagePkGuard,
	planDelete
} from '@visorcraft/mongreldb-kit';
import { kit, getDb } from '$lib/server/db';
import {
	tripExpenses,
	attachments,
	tripExpenseAttachments,
	tripBudgetCategories
} from '$lib/server/db/mongrelSchema';

export type KitExpense = Row<typeof tripExpenses>;
export type KitBudgetCategory = Row<typeof tripBudgetCategories>;

export interface ExpenseRow {
	id: number;
	tripId: number;
	description: string;
	amount: number;
	currency: string;
	category: string | null;
	exchangeRate: number;
	baseAmount: number;
	paidByCompanionId: number | null;
	splitAmong: string;
	createdAt: string;
}

export interface AttachmentRow {
	// id is the expense-attachment link id (matches the URL `[attachmentId]` parameter).
	id: number;
	attachmentId: number;
	filename: string;
	contentType: string;
	sizeBytes: number;
	createdAt: Date | string;
}

export interface BudgetCategoryRow {
	id: number;
	tripId: number;
	category: string;
	amount: number;
	currency: string;
	createdAt: string;
}

export type CreateExpenseInput = Pick<ExpenseRow, 'tripId' | 'description' | 'amount' | 'currency'> &
	Partial<Pick<ExpenseRow, 'category' | 'exchangeRate' | 'baseAmount'>> & {
		paidByCompanionId?: number | null;
		splitAmong?: string;
	};

export type UpdateExpenseInput = Partial<
	Omit<CreateExpenseInput, 'tripId'> & { splitAmong?: string }
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
	return toExpenseRow(row);
}

export function deleteExpense(id: number): boolean {
	const deleted = kit.deleteFrom(tripExpenses).where(kitEq(tripExpenses.id, toBigInt(id))).executeSync();
	return deleted > 0n;
}

// Attachments

export interface ExpenseAttachmentLinkRow {
	id: number;
	expenseId: number;
	attachmentId: number;
	createdAt: Date | string;
}

function mapJoinedAttachmentRow(row: Record<string, Record<string, unknown> | null>): AttachmentRow {
	const link = row.trip_expense_attachments;
	const att = row.attachments;
	if (!link || !att) {
		throw new Error('Missing attachment join data');
	}
	return {
		id: num(link.id as bigint),
		attachmentId: num(att.id as bigint),
		filename: String(att.filename),
		contentType: String(att.content_type),
		sizeBytes: Number(att.size_bytes),
		createdAt: link.created_at as Date | string
	};
}

export function listAttachmentsForExpense(expenseId: number): AttachmentRow[] {
	const orderedLinks = kit
		.selectFrom(tripExpenseAttachments)
		.where(kitEq(tripExpenseAttachments.expense_id, toBigInt(expenseId)))
		.orderBy(asc(tripExpenseAttachments.created_at));

	const rows = kit
		.with('trip_expense_attachments', orderedLinks)
		.selectFrom('trip_expense_attachments')
		.innerJoin(
			attachments,
			joinEq(
				tripExpenseAttachments,
				tripExpenseAttachments.attachment_id,
				attachments,
				attachments.id
			)
		)
		.executeSync();
	return rows.map(mapJoinedAttachmentRow);
}

export function listAttachmentsForExpenses(expenseIds: number[]): Map<number, AttachmentRow[]> {
	const map = new Map<number, AttachmentRow[]>();
	for (const id of expenseIds) map.set(id, []);
	if (expenseIds.length === 0) return map;

	const orderedLinks = kit
		.selectFrom(tripExpenseAttachments)
		.where(kitInList(tripExpenseAttachments.expense_id, expenseIds.map(toBigInt)))
		.orderBy(asc(tripExpenseAttachments.created_at));

	const rows = kit
		.with('trip_expense_attachments', orderedLinks)
		.selectFrom('trip_expense_attachments')
		.innerJoin(
			attachments,
			joinEq(
				tripExpenseAttachments,
				tripExpenseAttachments.attachment_id,
				attachments,
				attachments.id
			)
		)
		.executeSync();

	for (const row of rows) {
		const link = row.trip_expense_attachments;
		const expenseId = num(link!.expense_id as bigint);
		const att = mapJoinedAttachmentRow(row);
		map.get(expenseId)?.push(att);
	}
	return map;
}

function constraintKit() {
	const db = getDb();
	return { db: db.nativeDb, schema: db.schema };
}

export function createExpenseAttachmentLink(
	expenseId: number,
	attachmentId: number
): ExpenseAttachmentLinkRow {
	const db = getDb();
	const id = db.reserveAutoIncSync(tripExpenseAttachments.name)!;
	const now = new Date().toISOString();
	const row = {
		id,
		expense_id: toBigInt(expenseId),
		attachment_id: toBigInt(attachmentId),
		created_at: now
	};
	const ck = constraintKit();
	let result: ExpenseAttachmentLinkRow;
	runSyncTxn(db, (txn) => {
		enforceForeignKeys(ck, txn, tripExpenseAttachments, row);
		stageUniqueGuards(ck, txn, tripExpenseAttachments, row, id);
		stagePkGuard(ck, txn, tripExpenseAttachments, id, true);
		txn.put(tripExpenseAttachments.name, toCells(tripExpenseAttachments, row));
		result = {
			id: num(row.id),
			expenseId: num(row.expense_id),
			attachmentId: num(row.attachment_id),
			createdAt: row.created_at
		};
	});
	return result!;
}

export function getExpenseAttachmentLinkById(id: number): ExpenseAttachmentLinkRow | null {
	const rows = kit
		.selectFrom(tripExpenseAttachments)
		.where(kitEq(tripExpenseAttachments.id, toBigInt(id)))
		.executeSync();
	if (!rows[0]) return null;
	const link = rows[0];
	return {
		id: num(link.id),
		expenseId: num(link.expense_id),
		attachmentId: num(link.attachment_id),
		createdAt: link.created_at
	};
}

export function deleteExpenseAttachmentLink(id: number): boolean {
	const db = getDb();
	const rowJs = db.nativeDb.table(tripExpenseAttachments.name).getByPkInt64(BigInt(id));
	if (!rowJs) return false;
	const row = db
		.selectFrom(tripExpenseAttachments)
		.where(kitEq(tripExpenseAttachments.id, BigInt(id)))
		.executeSync()[0];
	if (!row) return false;
	const ck = constraintKit();
	runSyncTxn(db, (txn) => {
		planDelete(ck, txn, tripExpenseAttachments, BigInt(id), { row, rowId: rowJs.rowId });
	});
	return true;
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
	return toBudgetCategoryRow(row);
}

export function deleteBudgetCategory(id: number): boolean {
	const deleted = kit
		.deleteFrom(tripBudgetCategories)
		.where(kitEq(tripBudgetCategories.id, toBigInt(id)))
		.executeSync();
	return deleted > 0n;
}
