import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	BUDGET_CATEGORIES,
	setBudget,
	deleteBudget,
	listBudgetsWithSpent,
	setTripBudget,
	deleteTripBudget
} from './tripBudgets';
import { users, trips, tripBudgetCategories, auditLogs } from './db/schema';
import { eq, and } from 'drizzle-orm';

test('setBudget upserts and listBudgetsWithSpent returns spent and remaining', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'b1@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	setBudget(t.id, 'food', 10000);
	setBudget(t.id, 'lodging', 50000);

	const expenses = [
		{ amount: 8000, category: 'food' },
		{ amount: 2000, category: 'food' },
		{ amount: 10000, category: 'lodging' },
		{ amount: 3000 } // uncategorized -> other
	];

	const budgets = listBudgetsWithSpent(t.id, expenses);
	const food = budgets.find((b) => b.category === 'food')!;
	const lodging = budgets.find((b) => b.category === 'lodging')!;
	const other = budgets.find((b) => b.category === 'other')!;
	const transport = budgets.find((b) => b.category === 'transport')!;

	expect(food.amount).toBe(10000);
	expect(food.spent).toBe(10000);
	expect(food.remaining).toBe(0);
	expect(food.alert).toBe('over');

	expect(lodging.amount).toBe(50000);
	expect(lodging.spent).toBe(10000);
	expect(lodging.remaining).toBe(40000);
	expect(lodging.alert).toBe('ok');

	expect(other.amount).toBeNull();
	expect(other.spent).toBe(3000);
	expect(other.remaining).toBeNull();
	expect(other.alert).toBe('ok');

	expect(transport.amount).toBeNull();
	expect(transport.spent).toBe(0);

	expect(budgets).toHaveLength(BUDGET_CATEGORIES.length);
});

test('listBudgetsWithSpent buckets null and unknown categories into other', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'b5@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	setBudget(t.id, 'other', 5000);

	const budgets = listBudgetsWithSpent(t.id, [
		{ amount: 1000 },
		{ amount: 2000, category: null },
		{ amount: 1500, category: 'not-a-category' },
		{ amount: 500, category: 'food' }
	]);

	const other = budgets.find((b) => b.category === 'other')!;
	expect(other.spent).toBe(4500);

	const food = budgets.find((b) => b.category === 'food')!;
	expect(food.spent).toBe(500);
});

test('alert levels: ok, near, over', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'b2@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	setBudget(t.id, 'activities', 10000);
	setBudget(t.id, 'transport', 10000);
	setBudget(t.id, 'food', 10000);

	const budgets = listBudgetsWithSpent(t.id, [
		{ amount: 7900, category: 'activities' }, // just under 80%
		{ amount: 8000, category: 'transport' }, // exactly 80%
		{ amount: 10001, category: 'food' }
	]);

	expect(budgets.find((b) => b.category === 'activities')!.alert).toBe('ok');
	expect(budgets.find((b) => b.category === 'transport')!.alert).toBe('near');
	expect(budgets.find((b) => b.category === 'food')!.alert).toBe('over');
});

test('deleteBudget removes a cap', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'b3@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	setBudget(t.id, 'other', 5000);
	deleteBudget(t.id, 'other');

	const rows = db
		.select()
		.from(tripBudgetCategories)
		.where(eq(tripBudgetCategories.tripId, t.id))
		.all();
	expect(rows).toHaveLength(0);
});

test('setBudget updates existing cap', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'b4@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	setBudget(t.id, 'food', 10000);
	setBudget(t.id, 'food', 15000);

	const row = db
		.select()
		.from(tripBudgetCategories)
		.where(and(eq(tripBudgetCategories.tripId, t.id), eq(tripBudgetCategories.category, 'food')))
		.get();
	expect(row!.amount).toBe(15000);
});

test('setTripBudget and deleteTripBudget enforce editable trip ownership', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const owner = db.insert(users).values({ email: 'bo@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const other = db.insert(users).values({ email: 'bn@x.c', passwordHash: 'x', displayName: 'N' }).returning().get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();

	expect(() => setTripBudget(other.id, t.id, 'food', 10000)).toThrowError(
		expect.objectContaining({ status: 404 })
	);

	setTripBudget(owner.id, t.id, 'food', 10000);
	expect(() => deleteTripBudget(other.id, t.id, 'food')).toThrowError(
		expect.objectContaining({ status: 404 })
	);

	deleteTripBudget(owner.id, t.id, 'food');
	const audit = db
		.select()
		.from(auditLogs)
		.where(and(eq(auditLogs.entityType, 'trip_budget_category'), eq(auditLogs.userId, owner.id)))
		.all();
	expect(audit.some((a) => a.action === 'set')).toBe(true);
	expect(audit.some((a) => a.action === 'delete')).toBe(true);
});
