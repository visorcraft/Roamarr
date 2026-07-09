import { error } from '@sveltejs/kit';
import * as expensesRepo from '../repositories/expensesRepo';
import { requireCompanionOnTrip, requireCompanionsOnTrip, requireEditableTrip } from '../ownership';
import { logAudit } from '../audit';
import { BUDGET_CATEGORIES } from '../tripBudgets';
import type { TripExpenseView } from './types';

function parseSplitAmong(raw: string): Array<'owner' | number> {
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed.filter(
				(n): n is 'owner' | number =>
					n === 'owner' || (typeof n === 'number' && Number.isInteger(n) && n > 0)
			);
		}
	} catch {
		// fall through
	}
	return [];
}

function normalizeCategory(category?: string | null): string {
	if (category == null) return 'other';
	const c = category.trim().toLowerCase();
	if (!BUDGET_CATEGORIES.includes(c as (typeof BUDGET_CATEGORIES)[number])) {
		throw error(400, `Category must be one of: ${BUDGET_CATEGORIES.join(', ')}`);
	}
	return c;
}

function toExpenseView(row: expensesRepo.ExpenseRow): TripExpenseView {
	return {
		...row,
		exchangeRate: row.exchangeRate ?? 10000,
		baseAmount: row.baseAmount ?? 0,
		paidBy: row.paidByCompanionId ?? 'owner',
		splitAmong: parseSplitAmong(row.splitAmong)
	};
}

export function listTripExpenses(tripId: number): TripExpenseView[] {
	return expensesRepo
		.listExpensesForTrip(tripId)
		.map((r) => toExpenseView(r));
}

export function addTripExpense(
	userId: number,
	tripId: number,
	input: {
		description: string;
		amount: number;
		currency: string;
		category?: string | null;
		exchangeRate?: number;
		baseAmount?: number;
		paidByCompanionId?: number | null;
		splitAmong?: Array<'owner' | number>;
	}
) {
	requireEditableTrip(userId, tripId);

	const description = input.description.trim();
	if (!description) throw error(400, 'Description is required');
	if (!Number.isFinite(input.amount) || !Number.isInteger(input.amount) || input.amount <= 0) {
		throw error(400, 'Amount must be a positive integer');
	}
	const currency = (input.currency ?? 'USD').trim().toUpperCase();
	if (!currency || currency.length > 3) throw error(400, 'Currency must be 1-3 letters');
	const category = normalizeCategory(input.category);

	const exchangeRate =
		input.exchangeRate != null && Number.isInteger(input.exchangeRate) && input.exchangeRate > 0
			? input.exchangeRate
			: 10000;
	if (exchangeRate > 1_000_000_000) throw error(400, 'Exchange rate is too large');
	const baseAmount =
		input.baseAmount != null && Number.isInteger(input.baseAmount)
			? input.baseAmount
			: Math.round((input.amount * exchangeRate) / 10000);

	const paidByCompanionId = input.paidByCompanionId ?? null;
	const splitAmong = Array.from(
		new Set(
			(input.splitAmong ?? []).filter((n) => n === 'owner' || (Number.isInteger(n) && n > 0))
		)
	);

	requireCompanionOnTrip(paidByCompanionId, tripId);

	const splitCompanionIds = splitAmong.filter((n): n is number => typeof n === 'number');
	requireCompanionsOnTrip(splitCompanionIds, tripId);

	const inserted = expensesRepo.createExpense({
		tripId,
		description,
		amount: input.amount,
		currency,
		category,
		exchangeRate,
		baseAmount,
		paidByCompanionId,
		splitAmong: JSON.stringify(splitAmong)
	});

	logAudit(userId, 'create', 'trip_expense', inserted.id, {
		tripId,
		amount: input.amount,
		currency,
		category
	});

	return { ...toExpenseView(inserted), splitAmong };
}

export function deleteTripExpense(userId: number, expenseId: number) {
	const expense = expensesRepo.getExpenseById(expenseId);
	if (!expense) throw error(404, 'Expense not found');
	requireEditableTrip(userId, expense.tripId);
	expensesRepo.deleteExpense(expenseId);
	logAudit(userId, 'delete', 'trip_expense', expenseId, { tripId: expense.tripId });
}

export function updateTripExpense(
	userId: number,
	expenseId: number,
	patch: {
		description?: string;
		amount?: number;
		currency?: string;
		category?: string;
	}
) {
	const existing = expensesRepo.getExpenseById(expenseId);
	if (!existing) throw error(404, 'Expense not found');
	requireEditableTrip(userId, existing.tripId);
	const repoPatch: Parameters<typeof expensesRepo.updateExpense>[1] = {};
	if (patch.description !== undefined) repoPatch.description = patch.description;
	if (patch.amount !== undefined) repoPatch.amount = patch.amount;
	if (patch.currency !== undefined) repoPatch.currency = patch.currency;
	if (patch.category !== undefined) repoPatch.category = patch.category;
	const updated = expensesRepo.updateExpense(expenseId, repoPatch);
	if (!updated) throw error(404, 'Expense not found');
	logAudit(userId, 'update', 'trip_expense', expenseId, { tripId: existing.tripId });
	return updated;
}
