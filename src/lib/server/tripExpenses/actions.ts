import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '../auth';
import { Validator } from '../validation';
import { BUDGET_CATEGORIES } from '../tripBudgets';
import { addTripExpense, deleteTripExpense } from './repository';

export async function addExpense(event: RequestEvent) {
	const u = requireUser(event.locals);
	const tripId = Number(event.params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');

	const f = await event.request.formData();
	const v = new Validator();
	const description = v.requiredString(f.get('description'), 'description', { max: 200 });
	const amount = v.positiveId(f.get('amount'), 'amount');

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
	const u = requireUser(event.locals);
	const tripId = Number(event.params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');

	const f = await event.request.formData();
	const expenseId = Number(f.get('expenseId'));
	if (!Number.isFinite(expenseId) || expenseId <= 0) throw error(400, 'Invalid expense');

	deleteTripExpense(u.id, expenseId);
	throw redirect(303, `/trips/${tripId}`);
}
