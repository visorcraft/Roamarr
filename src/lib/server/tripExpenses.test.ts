import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	listTripExpenses,
	addTripExpense,
	deleteTripExpense,
	summarizeTripExpenses,
	computeSettlement,
	addExpense,
	deleteExpense
} from './tripExpenses';
import { users, trips, tripCompanions, tripExpenses, auditLogs } from './db/schema';
import { eq, and } from 'drizzle-orm';

function event(user: { id: number }, tripId: number, body: Record<string, string | string[]>) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(body)) {
		if (Array.isArray(value)) {
			for (const v of value) params.append(key, v);
		} else {
			params.append(key, value);
		}
	}
	return {
		locals: { user } as App.Locals,
		params: { id: String(tripId) },
		request: new Request('http://localhost/trips/' + tripId, {
			method: 'POST',
			body: params
		})
	} as any;
}

test('listTripExpenses returns expenses with parsed splitAmong', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'le@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const c = db
		.insert(tripCompanions)
		.values({ tripId: t.id, name: 'A', category: 'adult' })
		.returning()
		.get();

	addTripExpense(u.id, t.id, {
		description: 'Dinner',
		amount: 10000,
		currency: 'USD',
		paidByCompanionId: null,
		splitAmong: [c.id]
	});

	const expenses = listTripExpenses(t.id);
	expect(expenses).toHaveLength(1);
	expect(expenses[0].description).toBe('Dinner');
	expect(expenses[0].splitAmong).toEqual([c.id]);
	expect(expenses[0].paidBy).toBe('owner');
	expect(expenses[0].category).toBe('other');
});

test('addTripExpense defaults and validates category', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'cat@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	const defaulted = addTripExpense(u.id, t.id, { description: 'X', amount: 1000, currency: 'USD' });
	expect(defaulted.category).toBe('other');

	const food = addTripExpense(u.id, t.id, { description: 'Y', amount: 2000, currency: 'USD', category: 'food' });
	expect(food.category).toBe('food');

	expect(() =>
		addTripExpense(u.id, t.id, { description: 'Z', amount: 1000, currency: 'USD', category: 'invalid' })
	).toThrowError(expect.objectContaining({ status: 400 }));
});

test('addExpense action stores category', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'acat@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	await expect(
		addExpense(
			event(u, t.id, {
				description: 'Train',
				amount: '12000',
				currency: 'USD',
				category: 'transport',
				paidByCompanionId: '',
				splitAmong: []
			})
		)
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });

	const rows = db.select().from(tripExpenses).where(eq(tripExpenses.tripId, t.id)).all();
	expect(rows).toHaveLength(1);
	expect(rows[0].category).toBe('transport');
});

test('addExpense action returns validation failures', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'iv@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	expect(() =>
		addTripExpense(u.id, t.id, { description: '   ', amount: 1000, currency: 'USD' })
	).toThrowError(expect.objectContaining({ status: 400 }));
	expect(() =>
		addTripExpense(u.id, t.id, { description: 'X', amount: -10, currency: 'USD' })
	).toThrowError(expect.objectContaining({ status: 400 }));
	expect(() =>
		addTripExpense(u.id, t.id, { description: 'X', amount: 1000, currency: '' })
	).toThrowError(expect.objectContaining({ status: 400 }));
});

test('addTripExpense rejects payer or split companions from another trip', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'oc@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t1 = db.insert(trips).values({ ownerId: u.id, name: 'T1' }).returning().get();
	const t2 = db.insert(trips).values({ ownerId: u.id, name: 'T2' }).returning().get();
	const other = db
		.insert(tripCompanions)
		.values({ tripId: t2.id, name: 'Other', category: 'adult' })
		.returning()
		.get();

	expect(() =>
		addTripExpense(u.id, t1.id, {
			description: 'X',
			amount: 1000,
			currency: 'USD',
			paidByCompanionId: other.id
		})
	).toThrowError(expect.objectContaining({ status: 400 }));

	expect(() =>
		addTripExpense(u.id, t1.id, {
			description: 'X',
			amount: 1000,
			currency: 'USD',
			splitAmong: [other.id]
		})
	).toThrowError(expect.objectContaining({ status: 400 }));
});

test('deleteTripExpense removes expense for trip editor and logs audit', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const owner = db.insert(users).values({ email: 'oe@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const other = db.insert(users).values({ email: 'ne@x.c', passwordHash: 'x', displayName: 'N' }).returning().get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();
	const e = addTripExpense(owner.id, t.id, { description: 'Taxi', amount: 2500, currency: 'USD' });

	deleteTripExpense(owner.id, e.id);
	expect(db.select().from(tripExpenses).where(eq(tripExpenses.id, e.id)).get()).toBeUndefined();

	const audit = db
		.select()
		.from(auditLogs)
		.where(and(eq(auditLogs.entityType, 'trip_expense'), eq(auditLogs.entityId, e.id)))
		.all();
	expect(audit).toHaveLength(2);
	expect(audit.some((a) => a.action === 'delete')).toBe(true);

	const e2 = addTripExpense(owner.id, t.id, { description: 'Bus', amount: 1500, currency: 'USD' });
	expect(() => deleteTripExpense(other.id, e2.id)).toThrowError(expect.objectContaining({ status: 404 }));
});

test('summarizeTripExpenses computes totals and split balances', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'sm@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const a = db.insert(tripCompanions).values({ tripId: t.id, name: 'A', category: 'adult' }).returning().get();
	const b = db.insert(tripCompanions).values({ tripId: t.id, name: 'B', category: 'child' }).returning().get();

	addTripExpense(u.id, t.id, {
		description: 'Hotel',
		amount: 30000,
		currency: 'USD',
		paidByCompanionId: null,
		splitAmong: [a.id, b.id]
	});
	addTripExpense(u.id, t.id, {
		description: 'Dinner',
		amount: 12000,
		currency: 'USD',
		paidByCompanionId: a.id,
		splitAmong: [a.id, b.id]
	});

	const expenses = listTripExpenses(t.id);
	const summary = summarizeTripExpenses(expenses, [a, b]);

	expect(summary.totalsByCurrency).toEqual({ USD: 42000 });
	expect(summary.perPersonShareByCurrency).toEqual({ USD: 14000 });

	// Hotel: owner paid 30000, split between a and b => a owes 15000, b owes 15000
	// Dinner: a paid 12000, split between a and b => a owes 6000, b owes 6000
	// owner: +30000
	// a: -15000 + 12000 - 6000 = -9000
	// b: -15000 - 6000 = -21000
	expect(summary.balancesByCurrency.USD.owner).toBe(30000);
	expect(summary.balancesByCurrency.USD[a.id]).toBe(-9000);
	expect(summary.balancesByCurrency.USD[b.id]).toBe(-21000);
});

test('summarizeTripExpenses handles empty splitAmong as solo payer expense', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'ss@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const a = db.insert(tripCompanions).values({ tripId: t.id, name: 'A', category: 'adult' }).returning().get();

	addTripExpense(u.id, t.id, { description: 'Solo', amount: 5000, currency: 'USD' });
	const expenses = listTripExpenses(t.id);
	const summary = summarizeTripExpenses(expenses, [a]);

	expect(summary.totalsByCurrency).toEqual({ USD: 5000 });
	expect(summary.balancesByCurrency.USD.owner).toBe(0);
	expect(summary.balancesByCurrency.USD[a.id]).toBe(0);
});

test('summarizeTripExpenses handles multi-currency totals', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'mc@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	addTripExpense(u.id, t.id, { description: 'EUR', amount: 10000, currency: 'EUR' });
	addTripExpense(u.id, t.id, { description: 'USD', amount: 5000, currency: 'USD' });
	const expenses = listTripExpenses(t.id);
	const summary = summarizeTripExpenses(expenses, []);

	expect(summary.totalsByCurrency).toEqual({ EUR: 10000, USD: 5000 });
	expect(summary.perPersonShareByCurrency).toEqual({ EUR: 10000, USD: 5000 });
});

test('addExpense action creates an expense and redirects', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'ae@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const a = db.insert(tripCompanions).values({ tripId: t.id, name: 'A', category: 'adult' }).returning().get();

	await expect(
		addExpense(
			event(u, t.id, {
				description: 'Lunch',
				amount: '4500',
				currency: 'USD',
				paidByCompanionId: '',
				splitAmong: [String(a.id)]
			})
		)
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });

	const rows = db.select().from(tripExpenses).where(eq(tripExpenses.tripId, t.id)).all();
	expect(rows).toHaveLength(1);
	expect(rows[0].amount).toBe(4500);
});

test('addExpense action returns validation failures', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'av@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	const result = await addExpense(
		event(u, t.id, { description: '', amount: '0', currency: 'US Dollar' })
	);
	expect(result).toMatchObject({ status: 400 });
	expect(result.data.error).toBeDefined();
});

test('deleteExpense action removes an expense and redirects', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'de@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const e = addTripExpense(u.id, t.id, { description: 'X', amount: 1000, currency: 'USD' });

	await expect(deleteExpense(event(u, t.id, { expenseId: String(e.id) }))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	expect(db.select().from(tripExpenses).where(eq(tripExpenses.id, e.id)).get()).toBeUndefined();
});

test('computeSettlement equal split between owner and companion', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'ce@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const a = db.insert(tripCompanions).values({ tripId: t.id, name: 'A', category: 'adult' }).returning().get();

	addTripExpense(u.id, t.id, {
		description: 'Dinner',
		amount: 10000,
		currency: 'USD',
		paidByCompanionId: null,
		splitAmong: [a.id]
	});

	const settlement = computeSettlement(listTripExpenses(t.id), [{ id: a.id, name: 'A' }]);
	expect(settlement.USD.balances).toContainEqual({ companionId: 'owner', name: 'You', net: 10000 });
	expect(settlement.USD.balances).toContainEqual({ companionId: a.id, name: 'A', net: -10000 });
	expect(settlement.USD.payments).toEqual([{ from: a.id, to: 'owner', amount: 10000 }]);
});

test('computeSettlement uneven split across three people', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'ue@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const a = db.insert(tripCompanions).values({ tripId: t.id, name: 'A', category: 'adult' }).returning().get();
	const b = db.insert(tripCompanions).values({ tripId: t.id, name: 'B', category: 'adult' }).returning().get();

	addTripExpense(u.id, t.id, {
		description: 'Taxi',
		amount: 10000,
		currency: 'USD',
		paidByCompanionId: null,
		splitAmong: [a.id, b.id]
	});

	const settlement = computeSettlement(listTripExpenses(t.id), [
		{ id: a.id, name: 'A' },
		{ id: b.id, name: 'B' }
	]);
	expect(settlement.USD.payments).toHaveLength(2);
	const totalPaid = settlement.USD.payments.reduce((sum, p) => sum + p.amount, 0);
	expect(totalPaid).toBe(10000);
	expect(settlement.USD.payments.every((p) => p.to === 'owner')).toBe(true);
});

test('computeSettlement single person expense has no payments', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'se@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const a = db.insert(tripCompanions).values({ tripId: t.id, name: 'A', category: 'adult' }).returning().get();

	addTripExpense(u.id, t.id, {
		description: 'Solo',
		amount: 5000,
		currency: 'USD',
		paidByCompanionId: a.id,
		splitAmong: [a.id]
	});

	const settlement = computeSettlement(listTripExpenses(t.id), [{ id: a.id, name: 'A' }]);
	expect(settlement.USD.balances.find((b) => b.companionId === a.id)?.net).toBe(0);
	expect(settlement.USD.payments).toEqual([]);
});

test('computeSettlement owner-only expense leaves companions neutral', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'oo@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const a = db.insert(tripCompanions).values({ tripId: t.id, name: 'A', category: 'adult' }).returning().get();

	addTripExpense(u.id, t.id, {
		description: 'Owner-only',
		amount: 8000,
		currency: 'USD',
		paidByCompanionId: null,
		splitAmong: []
	});

	const settlement = computeSettlement(listTripExpenses(t.id), [{ id: a.id, name: 'A' }]);
	expect(settlement.USD.balances.find((b) => b.companionId === 'owner')?.net).toBe(0);
	expect(settlement.USD.balances.find((b) => b.companionId === a.id)?.net).toBe(0);
	expect(settlement.USD.payments).toEqual([]);
});

test('addTripExpense accepts owner as a split participant', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'ao@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const a = db.insert(tripCompanions).values({ tripId: t.id, name: 'A', category: 'adult' }).returning().get();

	const e = addTripExpense(u.id, t.id, {
		description: 'Gas',
		amount: 9000,
		currency: 'USD',
		paidByCompanionId: null,
		splitAmong: ['owner', a.id]
	});

	expect(e.splitAmong).toEqual(['owner', a.id]);
	const row = db.select().from(tripExpenses).where(eq(tripExpenses.id, e.id)).get();
	expect(JSON.parse(row!.splitAmong)).toEqual(['owner', a.id]);
});

test('addExpense action accepts owner split participant and redirects', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'as@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const a = db.insert(tripCompanions).values({ tripId: t.id, name: 'A', category: 'adult' }).returning().get();

	await expect(
		addExpense(
			event(u, t.id, {
				description: 'Toll',
				amount: '3000',
				currency: 'USD',
				paidByCompanionId: '',
				splitAmong: ['owner', String(a.id)]
			})
		)
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });

	const rows = db.select().from(tripExpenses).where(eq(tripExpenses.tripId, t.id)).all();
	expect(rows).toHaveLength(1);
	expect(JSON.parse(rows[0].splitAmong)).toEqual(['owner', a.id]);
});

test('summarizeTripExpenses splits expense among owner and companion', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'so@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const a = db.insert(tripCompanions).values({ tripId: t.id, name: 'A', category: 'adult' }).returning().get();

	addTripExpense(u.id, t.id, {
		description: 'Lunch',
		amount: 10000,
		currency: 'USD',
		paidByCompanionId: null,
		splitAmong: ['owner', a.id]
	});

	const summary = summarizeTripExpenses(listTripExpenses(t.id), [a]);
	// owner paid 10000 and owes 5000 => net +5000
	// a owes 5000 => net -5000
	expect(summary.balancesByCurrency.USD.owner).toBe(5000);
	expect(summary.balancesByCurrency.USD[a.id]).toBe(-5000);
});

test('computeSettlement with owner split participant produces correct payment', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'cs@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const a = db.insert(tripCompanions).values({ tripId: t.id, name: 'A', category: 'adult' }).returning().get();

	addTripExpense(u.id, t.id, {
		description: 'Lunch',
		amount: 10000,
		currency: 'USD',
		paidByCompanionId: null,
		splitAmong: ['owner', a.id]
	});

	const settlement = computeSettlement(listTripExpenses(t.id), [{ id: a.id, name: 'A' }]);
	expect(settlement.USD.balances).toContainEqual({ companionId: 'owner', name: 'You', net: 5000 });
	expect(settlement.USD.balances).toContainEqual({ companionId: a.id, name: 'A', net: -5000 });
	expect(settlement.USD.payments).toEqual([{ from: a.id, to: 'owner', amount: 5000 }]);
});
