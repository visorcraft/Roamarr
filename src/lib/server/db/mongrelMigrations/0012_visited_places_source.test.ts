import { describe, test, expect, vi } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { visitedCountries, visitedUsStates, users } from '../mongrelSchema';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import { migrations } from './index';
import { makeUser } from '../../../../../tests/helpers';

function runMigrationsUpTo12() {
	const migration12 = migrations.find((m) => m.version === 12);
	if (!migration12) throw new Error('Migration 12 not found');
	migration12.up({ kit, db: kit.nativeDb } as any);
}

describe('0012_visited_places_source', () => {
	test('prefixes bare US state codes with US-', () => {
		kit.deleteFrom(visitedUsStates).executeSync();
		kit.deleteFrom(visitedCountries).executeSync();
		kit.deleteFrom(users).executeSync();
		const user = makeUser(kit);
		kit.insertInto(visitedUsStates).values({
			user_id: BigInt(user.id),
			state_code: 'CA',
			visited_on: null,
			source: 'manual'
		}).executeSync();

		runMigrationsUpTo12();

		const rows = kit.selectFrom(visitedUsStates).executeSync();
		expect(rows.map((r) => r.state_code)).toEqual(['US-CA']);
	});

	test('removes duplicate bare state when ISO-3166-2 row already exists', () => {
		kit.deleteFrom(visitedUsStates).executeSync();
		kit.deleteFrom(visitedCountries).executeSync();
		kit.deleteFrom(users).executeSync();
		const user = makeUser(kit);
		kit.insertInto(visitedUsStates).values({
			user_id: BigInt(user.id),
			state_code: 'CA',
			visited_on: null,
			source: 'manual'
		}).executeSync();
		kit.insertInto(visitedUsStates).values({
			user_id: BigInt(user.id),
			state_code: 'US-CA',
			visited_on: null,
			source: 'trip'
		}).executeSync();

		runMigrationsUpTo12();

		const rows = kit
			.selectFrom(visitedUsStates)
			.where(kitEq(visitedUsStates.user_id, BigInt(user.id)))
			.executeSync();
		expect(rows).toHaveLength(1);
		expect(rows[0].state_code).toBe('US-CA');
		expect(rows[0].source).toBe('trip');
	});
});
