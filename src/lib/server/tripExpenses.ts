import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from './db';
import { tripCompanions, tripExpenses } from './db/schema';
import { requireUser } from './auth';
import { requireEditableTrip } from './ownership';
import { Validator } from './validation';
import { logAudit } from './audit';

export interface TripExpenseView {
	id: number;
	tripId: number;
	description: string;
	amount: number;
	currency: string;
	paidByCompanionId: number | null;
	paidBy: 'owner' | number;
	splitAmong: number[];
	createdAt: string;
}

export interface TripExpenseSummary {
	totalsByCurrency: Record<string, number>;
	perPersonShareByCurrency: Record<string, number>;
	balancesByCurrency: Record<string, Record<'owner' | number, number>>;
}

function parseSplitAmong(raw: string): number[] {
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed.filter(
				(n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0
			);
		}
	} catch {
		// fall through
	}
	return [];
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
		paidByCompanionId?: number | null;
		splitAmong?: number[];
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

	const paidByCompanionId = input.paidByCompanionId ?? null;
	const splitAmong = Array.from(
		new Set((input.splitAmong ?? []).filter((n) => Number.isInteger(n) && n > 0))
	);

	if (paidByCompanionId != null) {
		const c = db
			.select()
			.from(tripCompanions)
			.where(and(eq(tripCompanions.id, paidByCompanionId), eq(tripCompanions.tripId, tripId)))
			.get();
		if (!c) throw error(400, 'Payer companion is not on this trip');
	}

	if (splitAmong.length > 0) {
		const found = db
			.select({ id: tripCompanions.id })
			.from(tripCompanions)
			.where(and(eq(tripCompanions.tripId, tripId), inArray(tripCompanions.id, splitAmong)))
			.all();
		const foundIds = new Set(found.map((c) => c.id));
		if (foundIds.size !== splitAmong.length) throw error(400, 'Split companion not found');
	}

	const inserted = db
		.insert(tripExpenses)
		.values({
			tripId,
			description,
			amount: input.amount,
			currency,
			paidByCompanionId,
			splitAmong: JSON.stringify(splitAmong)
		})
		.returning()
		.get();

	logAudit(userId, 'create', 'trip_expense', inserted.id, {
		tripId,
		amount: input.amount,
		currency
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

export function summarizeTripExpenses(
	expenses: TripExpenseView[],
	companions: { id: number }[]
): TripExpenseSummary {
	const people: Array<'owner' | number> = ['owner', ...companions.map((c) => c.id)];
	const totalsByCurrency: Record<string, number> = {};
	const balancesByCurrency: Record<string, Record<'owner' | number, number>> = {};

	for (const e of expenses) {
		totalsByCurrency[e.currency] = (totalsByCurrency[e.currency] ?? 0) + e.amount;
		if (!balancesByCurrency[e.currency]) {
			const initial: Record<'owner' | number, number> = { owner: 0 };
			for (const c of companions) initial[c.id] = 0;
			balancesByCurrency[e.currency] = initial;
		}

		const payer: 'owner' | number = e.paidByCompanionId ?? 'owner';
		balancesByCurrency[e.currency][payer] += e.amount;

		const splitPeople: Array<'owner' | number> =
			e.splitAmong.length > 0 ? e.splitAmong : [payer];
		const count = splitPeople.length;
		const baseShare = Math.floor(e.amount / count);
		const remainder = e.amount % count;

		for (let i = 0; i < splitPeople.length; i++) {
			const person = splitPeople[i];
			const share = baseShare + (i < remainder ? 1 : 0);
			balancesByCurrency[e.currency][person] -= share;
		}
	}

	const perPersonShareByCurrency: Record<string, number> = {};
	const peopleCount = people.length;
	for (const [currency, total] of Object.entries(totalsByCurrency)) {
		perPersonShareByCurrency[currency] = Math.round(total / peopleCount);
	}

	return { totalsByCurrency, perPersonShareByCurrency, balancesByCurrency };
}

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

	let paidByCompanionId: number | null = null;
	const paidByRaw = f.get('paidByCompanionId');
	if (paidByRaw && String(paidByRaw).trim()) {
		paidByCompanionId = v.positiveId(paidByRaw, 'paidByCompanionId') ?? null;
	}

	const splitAmong = f
		.getAll('splitAmong')
		.map((raw) => Number(raw))
		.filter((n) => Number.isFinite(n) && Number.isInteger(n) && n > 0);

	if (!v.ok()) {
		return fail(400, { error: v.failMessage(), errors: v.errors });
	}

	addTripExpense(u.id, tripId, {
		description: description!,
		amount: amount!,
		currency,
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
