import { describe, it, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { DatabaseSeeder } from './seedDatabase';
import {
	users,
	trips,
	segments,
	cards,
	cardBenefits,
	travelDocuments,
	groups,
	groupMembers,
	visitedCountries,
	visitedUsStates,
	fareProviders,
	fareWatches,
	reminders,
	notifications,
	insurancePolicies,
	loyaltyPrograms,
	emergencyContacts,
	tripBudgetCategories,
	tripExpenses,
	tripChecklistItems,
	tripChecklists,
	tripDocumentLinks,
	tripJournalEntries,
	tripCompanions,
	tripShares
} from './db/mongrelSchema';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

describe('DatabaseSeeder', () => {
	beforeEach(() => {
		const kit = kitDb();
		[
			notifications,
			reminders,
			fareWatches,
			fareProviders,
			visitedCountries,
			visitedUsStates,
			groupMembers,
			groups,
			tripShares,
			travelDocuments,
			cardBenefits,
			cards,
			insurancePolicies,
			loyaltyPrograms,
			emergencyContacts,
			tripBudgetCategories,
			tripExpenses,
			tripChecklistItems,
			tripChecklists,
			tripDocumentLinks,
			tripJournalEntries,
			tripCompanions,
			segments,
			trips,
			users
		].forEach((t) => {
			try {
				kit.deleteFrom(t).executeSync();
			} catch {
				/* ignore */
			}
		});
	});

	it('seeds a complete account', async () => {
		const kit = kitDb();
		const seeder = new DatabaseSeeder({
			email: 'seed-test@example.com',
			password: 'correct-horse-battery-staple'
		});
		await seeder.run();

		expect(kit.selectFrom(users).executeSync().length).toBe(3);
		expect(kit.selectFrom(trips).executeSync().length).toBe(6);
		expect(kit.selectFrom(segments).executeSync().length).toBe(12);
		expect(kit.selectFrom(cards).executeSync().length).toBe(2);
		expect(kit.selectFrom(cardBenefits).executeSync().length).toBe(2);
		expect(kit.selectFrom(travelDocuments).executeSync().length).toBe(3);
		expect(kit.selectFrom(groups).executeSync().length).toBe(1);
		expect(kit.selectFrom(groupMembers).executeSync().length).toBe(3);
		expect(kit.selectFrom(visitedCountries).executeSync().length).toBe(3);
		expect(kit.selectFrom(visitedUsStates).executeSync().length).toBe(2);
		expect(kit.selectFrom(fareWatches).executeSync().length).toBe(6);
		expect(kit.selectFrom(reminders).executeSync().length).toBe(6);
		expect(kit.selectFrom(notifications).executeSync().length).toBe(2);

		const futureTrip = kit
			.selectFrom(trips)
			.executeSync()
			.find((t) => String(t.name).includes('Spring break'));
		expect(futureTrip).toBeTruthy();
		expect(String(futureTrip!.start_date).slice(0, 4)).toBe('2027');
	});

	it('is re-runnable without unique-constraint errors', async () => {
		const seeder = new DatabaseSeeder({
			email: 'seed-test@example.com',
			password: 'correct-horse-battery-staple'
		});
		await seeder.run();
		await seeder.run();

		const kit = kitDb();
		expect(kit.selectFrom(users).executeSync().length).toBe(3);
		expect(kit.selectFrom(trips).executeSync().length).toBe(6);
	}, 30_000);
});
