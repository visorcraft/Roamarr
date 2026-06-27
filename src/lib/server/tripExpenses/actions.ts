import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { withTripAction } from '../actions';
import { Validator } from '../validation';
import { BUDGET_CATEGORIES } from '../tripBudgets';
import { addTripExpense, deleteTripExpense } from './repository';

function moneyToCents(raw: unknown, field: string, v: Validator): number | undefined {
	const str = String(raw ?? '').trim();
	if (!str) {
		v.addError(field, `${field} is required`);
		return undefined;
	}
	if (!/^\d+(\.\d{1,2})?$/.test(str)) {
		v.addError(field, `${field} must be a positive amount with up to 2 decimals`);
		return undefined;
	}
	const [whole, fraction = ''] = str.split('.');
	const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
	if (!Number.isSafeInteger(cents) || cents <= 0) {
		v.addError(field, `${field} must be a positive amount`);
		return undefined;
	}
	return cents;
}

export async function addExpense(event: RequestEvent) {
	const { user: u, tripId, formData: f } = await withTripAction(event);
	const v = new Validator();
	const description = v.requiredString(f.get('description'), 'description', { max: 200 });
	const amount = moneyToCents(f.get('amount'), 'amount', v);

	const currencyRaw = typeof f.get('currency') === 'string' ? String(f.get('currency')) : 'USD';
	const currency = currencyRaw.trim().toUpperCase();
	if (!currency || currency.length > 3) v.addError('currency', 'Currency must be 1-3 letters');

	const exchangeRateRaw = f.get('exchangeRate');
	let exchangeRate: number | undefined;
	if (exchangeRateRaw != null && String(exchangeRateRaw).trim() !== '') {
		const n = Number(exchangeRateRaw);
		if (!Number.isFinite(n) || n <= 0) {
			v.addError('exchangeRate', 'Exchange rate must be a positive number');
		} else {
			exchangeRate = Math.round(n * 10000);
		}
	}

	let paidByCompanionId: number | null = null;
	const paidByRaw = f.get('paidByCompanionId');
	if (paidByRaw && String(paidByRaw).trim()) {
		paidByCompanionId = v.positiveId(paidByRaw, 'paidByCompanionId') ?? null;
	}

	const categoryRaw = f.get('category');
	let category: string | undefined;
	if (typeof categoryRaw === 'string' && categoryRaw.trim()) {
		category = v.enumValue(categoryRaw.trim(), BUDGET_CATEGORIES as readonly string[], 'category');
	}

	const splitAmong = f
		.getAll('splitAmong')
		.map((raw) => (raw === 'owner' ? 'owner' : Number(raw)))
		.filter((n): n is 'owner' | number =>
			n === 'owner' || (Number.isFinite(n) && Number.isInteger(n) && n > 0)
		);

	if (!v.ok()) {
		return fail(400, { error: v.failMessage(), errors: v.errors });
	}

	addTripExpense(u.id, tripId, {
		description: description!,
		amount: amount!,
		currency,
		category,
		exchangeRate,
		paidByCompanionId,
		splitAmong
	});

	throw redirect(303, `/trips/${tripId}`);
}

export async function deleteExpense(event: RequestEvent) {
	const { user: u, tripId, formData: f } = await withTripAction(event);
	const expenseId = Number(f.get('expenseId'));
	if (!Number.isFinite(expenseId) || expenseId <= 0) throw error(400, 'Invalid expense');

	deleteTripExpense(u.id, expenseId);
	throw redirect(303, `/trips/${tripId}`);
}
