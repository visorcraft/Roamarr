import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
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
import { tripBudgetCategories, auditLogs, trips, users } from './db/mongrelSchema';
import { eq, and, type KitDatabase } from '@mongreldb/kit';
import { makeSyncedUser, makeSyncedTrip } from '../../../tests/helpers';

function getKit(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

beforeEach(() => {
	const kit = getKit();
	kit.deleteFrom(tripBudgetCategories).executeSync();
	kit.deleteFrom(auditLogs).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('setBudget upserts and listBudgetsWithSpent returns spent and remaining', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'b1@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

	setBudget(t.id, 'food', 10000, 'EUR');
	setBudget(t.id, 'lodging', 50000);

	const expenses = [
		{ amount: 8000, currency: 'EUR', category: 'food' },
		{ amount: 2000, currency: 'EUR', category: 'food' },
		{ amount: 9999, currency: 'USD', category: 'food' },
		{ amount: 10000, currency: 'USD', category: 'lodging' },
		{ amount: 3000, currency: 'USD' } // uncategorized -> other
	];

	const budgets = listBudgetsWithSpent(t.id, expenses);
	const food = budgets.find((b) => b.category === 'food')!;
	const lodging = budgets.find((b) => b.category === 'lodging')!;
	const other = budgets.find((b) => b.category === 'other')!;
	const transport = budgets.find((b) => b.category === 'transport')!;

	expect(food.amount).toBe(10000);
	expect(food.currency).toBe('EUR');
	expect(food.spent).toBe(10000);
	expect(food.remaining).toBe(0);
	expect(food.alert).toBe('over');

	expect(lodging.amount).toBe(50000);
	expect(lodging.currency).toBe('USD');
	expect(lodging.spent).toBe(10000);
	expect(lodging.remaining).toBe(40000);
	expect(lodging.alert).toBe('ok');

	expect(other.amount).toBeNull();
	expect(other.currency).toBe('USD');
	expect(other.spent).toBe(3000);
	expect(other.remaining).toBeNull();
	expect(other.alert).toBe('ok');

	expect(transport.amount).toBeNull();
	expect(transport.spent).toBe(0);

	expect(budgets).toHaveLength(BUDGET_CATEGORIES.length);
});

test('listBudgetsWithSpent buckets null and unknown categories into other', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'b5@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

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
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'b2@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

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
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'b3@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

	setBudget(t.id, 'other', 5000);
	deleteBudget(t.id, 'other');

	const rows = kit
		.selectFrom(tripBudgetCategories)
		.where(eq(tripBudgetCategories.trip_id, BigInt(t.id)))
		.executeSync();
	expect(rows).toHaveLength(0);
});

test('setBudget updates existing cap', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'b4@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

	setBudget(t.id, 'food', 10000);
	setBudget(t.id, 'food', 15000, 'EUR');

	const row = kit
		.selectFrom(tripBudgetCategories)
		.where(and(eq(tripBudgetCategories.trip_id, BigInt(t.id)), eq(tripBudgetCategories.category, 'food')))
		.executeSync()[0];
	expect(Number(row!.amount)).toBe(15000);
	expect(row!.currency).toBe('USD');
});

test('setTripBudget snapshots the editing users default currency and deleteTripBudget enforces ownership', () => {
	const kit = getKit();
	const owner = makeSyncedUser(kit, {
		email: 'bo@x.c',
		passwordHash: 'x',
		displayName: 'O',
		defaultCurrency: 'GBP'
	});
	const other = makeSyncedUser(kit, { email: 'bn@x.c', passwordHash: 'x', displayName: 'N' });
	const t = makeSyncedTrip(kit, { ownerId: owner.id, name: 'T' });

	expect(() => setTripBudget(other.id, t.id, 'food', 10000)).toThrowError(
		expect.objectContaining({ status: 404 })
	);

	setTripBudget(owner.id, t.id, 'food', 10000);
	const row = kit
		.selectFrom(tripBudgetCategories)
		.where(and(eq(tripBudgetCategories.trip_id, BigInt(t.id)), eq(tripBudgetCategories.category, 'food')))
		.executeSync()[0];
	expect(row!.currency).toBe('GBP');

	expect(() => deleteTripBudget(other.id, t.id, 'food')).toThrowError(
		expect.objectContaining({ status: 404 })
	);

	deleteTripBudget(owner.id, t.id, 'food');
	const audit = kit
		.selectFrom(auditLogs)
		.where(and(eq(auditLogs.entity_type, 'trip_budget_category'), eq(auditLogs.user_id, BigInt(owner.id))))
		.executeSync();
	expect(audit.some((a: Record<string, unknown>) => a.action === 'set')).toBe(true);
	expect(audit.some((a: Record<string, unknown>) => a.action === 'delete')).toBe(true);
});
