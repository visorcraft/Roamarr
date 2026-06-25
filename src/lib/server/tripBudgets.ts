import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { tripBudgetCategories, users } from './db/schema';
import { withTripAction } from './actions';
import { requireEditableTrip } from './ownership';
import { Validator } from './validation';
import { logAudit } from './audit';

export const BUDGET_CATEGORIES = ['lodging', 'transport', 'food', 'activities', 'other'] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];
type BudgetAlertLevel = 'ok' | 'near' | 'over';

export interface BudgetWithSpent {
	category: BudgetCategory;
	amount: number | null;
	currency: string;
	spent: number;
	remaining: number | null;
	alert: BudgetAlertLevel;
}

export interface BudgetExpense {
	amount: number;
	currency?: string | null;
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
		throw error(400, 'Budget amount must be positive');
	}
	return amount;
}

function normalizeCurrency(currency: string | null | undefined): string {
	const normalized = (currency ?? 'USD').trim().toUpperCase();
	return /^[A-Z]{3}$/.test(normalized) ? normalized : 'USD';
}

function assertCurrency(currency: string): string {
	const normalized = normalizeCurrency(currency);
	if (normalized !== currency.trim().toUpperCase()) {
		throw error(400, 'Currency must be a 3-letter currency code');
	}
	return normalized;
}

function parseCurrencyAmount(raw: FormDataEntryValue | null): number | undefined {
	const value = String(raw ?? '').trim();
	if (!/^\d+(\.\d{1,2})?$/.test(value)) return undefined;
	const [whole, fraction = ''] = value.split('.');
	const dollars = Number(whole);
	if (!Number.isSafeInteger(dollars)) return undefined;
	const cents = Number(fraction.padEnd(2, '0'));
	const total = dollars * 100 + cents;
	return total > 0 && Number.isSafeInteger(total) ? total : undefined;
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

export function setBudget(tripId: number, category: BudgetCategory, amount: number, currency = 'USD') {
	assertCategory(category);
	assertAmount(amount);
	const normalizedCurrency = assertCurrency(currency);
	return db
		.insert(tripBudgetCategories)
		.values({ tripId, category, amount, currency: normalizedCurrency })
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
	expenses: readonly BudgetExpense[],
	fallbackCurrency = 'USD'
): BudgetWithSpent[] {
	const defaultCurrency = normalizeCurrency(fallbackCurrency);
	const rows = db
		.select()
		.from(tripBudgetCategories)
		.where(eq(tripBudgetCategories.tripId, tripId))
		.all();
	const capByCategory = new Map<BudgetCategory, { amount: number; currency: string }>();
	for (const r of rows) {
		if (BUDGET_CATEGORIES.includes(r.category as BudgetCategory)) {
			capByCategory.set(r.category as BudgetCategory, {
				amount: r.amount,
				currency: normalizeCurrency(r.currency)
			});
		}
	}

	const spentByCategoryCurrency = new Map<string, number>();
	for (const e of expenses) {
		const bucket = bucketForExpense(e);
		const currency = normalizeCurrency(e.currency ?? defaultCurrency);
		const key = `${bucket}:${currency}`;
		spentByCategoryCurrency.set(key, (spentByCategoryCurrency.get(key) ?? 0) + e.amount);
	}

	return BUDGET_CATEGORIES.map((category) => {
		const cap = capByCategory.get(category);
		const amount = cap?.amount ?? null;
		const currency = cap?.currency ?? defaultCurrency;
		const spent = spentByCategoryCurrency.get(`${category}:${currency}`) ?? 0;
		const remaining = amount != null ? amount - spent : null;
		return { category, amount, currency, spent, remaining, alert: computeAlert(spent, amount) };
	});
}

export function setTripBudget(
	userId: number,
	tripId: number,
	category: BudgetCategory,
	amount: number
) {
	requireEditableTrip(userId, tripId);
	const u = db.select({ defaultCurrency: users.defaultCurrency }).from(users).where(eq(users.id, userId)).get();
	const row = setBudget(tripId, category, amount, u?.defaultCurrency ?? 'USD');
	logAudit(userId, 'set', 'trip_budget_category', row.id, {
		tripId,
		category,
		amount,
		currency: row.currency
	});
	return row;
}

export function deleteTripBudget(userId: number, tripId: number, category: BudgetCategory) {
	requireEditableTrip(userId, tripId);
	deleteBudget(tripId, category);
	logAudit(userId, 'delete', 'trip_budget_category', tripId, { tripId, category });
}

export async function setBudgetAction(event: RequestEvent) {
	const { user: u, tripId, formData: f } = await withTripAction(event);
	const v = new Validator();
	const category = v.enumValue(f.get('category'), BUDGET_CATEGORIES as readonly string[], 'category');
	const amount = parseCurrencyAmount(f.get('amount'));
	if (amount == null) {
		v.addError('amount', 'Amount must be a positive currency amount');
	}

	if (!v.ok()) {
		return fail(400, { error: v.failMessage(), errors: v.errors });
	}

	setTripBudget(u.id, tripId, category as BudgetCategory, amount!);
	throw redirect(303, `/trips/${tripId}`);
}

export async function deleteBudgetAction(event: RequestEvent) {
	const { user: u, tripId, formData: f } = await withTripAction(event);
	const category = String(f.get('category') || '');
	if (!category) throw error(400, 'Category is required');

	deleteTripBudget(u.id, tripId, category as BudgetCategory);
	throw redirect(303, `/trips/${tripId}`);
}
