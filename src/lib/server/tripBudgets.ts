import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { tripBudgetCategories } from './db/schema';
import { requireUser } from './auth';
import { requireEditableTrip } from './ownership';
import { Validator } from './validation';
import { logAudit } from './audit';

export const BUDGET_CATEGORIES = ['lodging', 'transport', 'food', 'activities', 'other'] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];
type BudgetAlertLevel = 'ok' | 'near' | 'over';

export interface BudgetWithSpent {
	category: BudgetCategory;
	amount: number | null;
	spent: number;
	remaining: number | null;
	alert: BudgetAlertLevel;
}

export interface BudgetExpense {
	amount: number;
	category?: string | null;
}

function assertCategory(category: string): BudgetCategory {
	if (!BUDGET_CATEGORIES.includes(category as BudgetCategory)) {
		throw error(400, `Invalid budget category: ${category}`);
	}
	return category as BudgetCategory;
}

function assertAmount(amount: number): number {
	if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
		throw error(400, 'Budget amount must be a positive integer');
	}
	return amount;
}

function bucketForExpense(expense: BudgetExpense): BudgetCategory {
	const c = expense.category;
	if (c && BUDGET_CATEGORIES.includes(c as BudgetCategory)) return c as BudgetCategory;
	return 'other';
}

function computeAlert(spent: number, amount: number | null): BudgetAlertLevel {
	if (amount == null) return 'ok';
	if (spent >= amount) return 'over';
	if (spent >= amount * 0.8) return 'near';
	return 'ok';
}

export function setBudget(tripId: number, category: BudgetCategory, amount: number) {
	assertCategory(category);
	assertAmount(amount);
	return db
		.insert(tripBudgetCategories)
		.values({ tripId, category, amount })
		.onConflictDoUpdate({
			target: [tripBudgetCategories.tripId, tripBudgetCategories.category],
			set: { amount }
		})
		.returning()
		.get();
}

export function deleteBudget(tripId: number, category: BudgetCategory) {
	assertCategory(category);
	db.delete(tripBudgetCategories)
		.where(and(eq(tripBudgetCategories.tripId, tripId), eq(tripBudgetCategories.category, category)))
		.run();
}

export function listBudgetsWithSpent(
	tripId: number,
	expenses: readonly BudgetExpense[]
): BudgetWithSpent[] {
	const rows = db
		.select()
		.from(tripBudgetCategories)
		.where(eq(tripBudgetCategories.tripId, tripId))
		.all();
	const amountByCategory = new Map<BudgetCategory, number>();
	for (const r of rows) {
		if (BUDGET_CATEGORIES.includes(r.category as BudgetCategory)) {
			amountByCategory.set(r.category as BudgetCategory, r.amount);
		}
	}

	const spentByCategory = new Map<BudgetCategory, number>();
	for (const c of BUDGET_CATEGORIES) spentByCategory.set(c, 0);
	for (const e of expenses) {
		const bucket = bucketForExpense(e);
		spentByCategory.set(bucket, (spentByCategory.get(bucket) ?? 0) + e.amount);
	}

	return BUDGET_CATEGORIES.map((category) => {
		const amount = amountByCategory.get(category) ?? null;
		const spent = spentByCategory.get(category) ?? 0;
		const remaining = amount != null ? amount - spent : null;
		return { category, amount, spent, remaining, alert: computeAlert(spent, amount) };
	});
}

export function setTripBudget(
	userId: number,
	tripId: number,
	category: BudgetCategory,
	amount: number
) {
	requireEditableTrip(userId, tripId);
	const row = setBudget(tripId, category, amount);
	logAudit(userId, 'set', 'trip_budget_category', row.id, { tripId, category, amount });
	return row;
}

export function deleteTripBudget(userId: number, tripId: number, category: BudgetCategory) {
	requireEditableTrip(userId, tripId);
	deleteBudget(tripId, category);
	logAudit(userId, 'delete', 'trip_budget_category', tripId, { tripId, category });
}

export async function setBudgetAction(event: RequestEvent) {
	const u = requireUser(event.locals);
	const tripId = Number(event.params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');

	const f = await event.request.formData();
	const v = new Validator();
	const category = v.enumValue(f.get('category'), BUDGET_CATEGORIES as readonly string[], 'category');
	const amount = v.positiveId(f.get('amount'), 'amount');

	if (!v.ok()) {
		return fail(400, { error: v.failMessage(), errors: v.errors });
	}

	setTripBudget(u.id, tripId, category as BudgetCategory, amount!);
	throw redirect(303, `/trips/${tripId}`);
}

export async function deleteBudgetAction(event: RequestEvent) {
	const u = requireUser(event.locals);
	const tripId = Number(event.params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');

	const f = await event.request.formData();
	const category = String(f.get('category') || '');
	if (!category) throw error(400, 'Category is required');

	deleteTripBudget(u.id, tripId, category as BudgetCategory);
	throw redirect(303, `/trips/${tripId}`);
}
