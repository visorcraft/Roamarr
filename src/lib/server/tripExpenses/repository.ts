import { eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from '../db';
import { tripExpenses } from '../db/schema';
import { requireCompanionOnTrip, requireCompanionsOnTrip, requireEditableTrip } from '../ownership';
import { logAudit } from '../audit';
import { BUDGET_CATEGORIES } from '../tripBudgets';
import type { TripExpenseView } from './types';

export function parseSplitAmong(raw: string): Array<'owner' | number> {
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

export function normalizeCategory(category?: string | null): string {
	if (category == null) return 'other';
	const c = category.trim().toLowerCase();
	if (!BUDGET_CATEGORIES.includes(c as (typeof BUDGET_CATEGORIES)[number])) {
		throw error(400, `Category must be one of: ${BUDGET_CATEGORIES.join(', ')}`);
	}
	return c;
}

export function listTripExpenses(tripId: number): TripExpenseView[] {
	const rows = db
		.select()
		.from(tripExpenses)
		.where(eq(tripExpenses.tripId, tripId))
		.orderBy(tripExpenses.createdAt)
		.all();
	return rows.map((r) => ({
		...r,
		exchangeRate: r.exchangeRate ?? 10000,
		baseAmount: r.baseAmount ?? 0,
		paidBy: r.paidByCompanionId ?? 'owner',
		splitAmong: parseSplitAmong(r.splitAmong)
	}));
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

	const inserted = db
		.insert(tripExpenses)
		.values({
			tripId,
			description,
			amount: input.amount,
			currency,
			category,
			exchangeRate,
			baseAmount,
			paidByCompanionId,
			splitAmong: JSON.stringify(splitAmong)
		})
		.returning()
		.get();

	logAudit(userId, 'create', 'trip_expense', inserted.id, {
		tripId,
		amount: input.amount,
		currency,
		category
	});

	return { ...inserted, paidBy: inserted.paidByCompanionId ?? 'owner', splitAmong };
}

export function deleteTripExpense(userId: number, expenseId: number) {
	const expense = db
		.select({ id: tripExpenses.id, tripId: tripExpenses.tripId })
		.from(tripExpenses)
		.where(eq(tripExpenses.id, expenseId))
		.get();
	if (!expense) throw error(404, 'Expense not found');
	requireEditableTrip(userId, expense.tripId);
	db.delete(tripExpenses).where(eq(tripExpenses.id, expenseId)).run();
	logAudit(userId, 'delete', 'trip_expense', expenseId, { tripId: expense.tripId });
}
